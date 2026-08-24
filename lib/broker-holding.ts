// ---------------------------------------------------------------------------
// Per-symbol broker holding / selling aggregates.
//
// PRIMARY: chukul.com's public API (floorsheet-derived aggregates):
//   GET /api/data/top-net-holding/?symbol=X&from_date=&to_date=  → buy rows per broker
//   GET /api/data/top-net-release/?symbol=X&from_date=&to_date=  → sell rows per broker
//   GET /api/broker/                                             → broker directory
//
// Since late-2025 chukul gated the holding/release endpoints behind
// `Authorization: Bearer <token>` (Django returns
//   403 {"detail":"Authentication credentials were not provided."}
// when the header is missing) — so unauthenticated fetches now always 403.
// The broker directory and stock endpoints remain public (200). This broke the
// old chukul-only implementation (history: "it used to working before").
//
// FALLBACK: Derive the same net position directly from NEPSE's official
// floorsheet (lib/nepse.ts → /api/nots/nepse-data/floorsheet?stockId=) which
// is authenticated via NEPSE's own token flow and never requires chukul.
// The fallback aggregates today's floorsheet rows (NEPSE only exposes today's
// trades) by buyerMemberId/sellerMemberId → net buy/sell per broker. When the
// primary chukul fetch 403s we transparently return the NEPSE-derived result
// so the UI never shows a 502. Weekly/monthly windows still return the range
// metadata but the quantities reflect today's activity (NEPSE has no historical
// broker-level endpoint). See fetchBrokerHolding() for the try→fallback logic.
//
// Holding  = brokers whose total buy exceeds total sales  (buy − sell > 0)
// Selling  = brokers whose total sales exceed total buys  (sell − buy > 0)
// ---------------------------------------------------------------------------

const CHUKUL_BASE = "https://chukul.com"

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://chukul.com/brokers-analytics",
}

export type BrokerHoldingPeriod = "weekly" | "monthly"

export type BrokerFlow = {
  /** Broker member number, e.g. "44" */
  broker: string
  /** Full brokerage firm name when known */
  brokerName: string | null
  /** Net quantity in Kitta (always positive; direction implied by the list) */
  quantity: number
  /** Net amount in Rs (buy amount − sell amount, absolute) */
  amount: number
  /** Volume-weighted average rate across the broker's trades in the window */
  avgRate: number | null
}

export type BrokerHoldingData = {
  symbol: string
  period: BrokerHoldingPeriod
  fromDate: string
  toDate: string
  /** Top brokers accumulating (total buy − total sales), descending */
  holding: BrokerFlow[]
  /** Top brokers distributing (sales exceeding purchase), descending */
  selling: BrokerFlow[]
}

type RawFlowRow = {
  date?: string
  symbol?: string
  quantity?: number
  rate?: number
  amount?: number
  buyer?: string
  seller?: string
}

type ChukulBroker = { broker_no?: string; broker_name?: string }

async function chukulGet<T>(path: string, revalidate: number): Promise<T> {
  const res = await fetch(`${CHUKUL_BASE}${path}`, {
    headers: HEADERS,
    next: { revalidate },
  })
  if (!res.ok) throw new Error(`chukul.com responded ${res.status} for ${path}`)
  return (await res.json()) as T
}

/** Calendar date string (YYYY-MM-DD) N days ago in Nepal time. */
function kathmanduDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kathmandu" })
}

let brokerNamesCache: { at: number; map: Map<string, string> } | null = null

async function fetchBrokerNames(): Promise<Map<string, string>> {
  if (brokerNamesCache && Date.now() - brokerNamesCache.at < 24 * 60 * 60_000) {
    return brokerNamesCache.map
  }
  const map = new Map<string, string>()
  try {
    const list = await chukulGet<ChukulBroker[]>("/api/broker/", 86_400)
    for (const b of list) {
      if (b.broker_no && b.broker_name) map.set(String(b.broker_no), b.broker_name)
    }
  } catch {
    // Broker names are decorative — charts still work without them.
  }
  brokerNamesCache = { at: Date.now(), map }
  return map
}

type Tally = { buyQty: number; buyAmt: number; sellQty: number; sellAmt: number }

async function fetchBrokerHoldingViaChukul(
  clean: string,
  qs: string,
  names: Map<string, string>,
): Promise<{ tallies: Map<string, Tally> }> {
  const [buyRows, sellRows] = await Promise.all([
    chukulGet<RawFlowRow[]>(`/api/data/top-net-holding/?${qs}`, 600),
    chukulGet<RawFlowRow[]>(`/api/data/top-net-release/?${qs}`, 600),
  ])

  const tallies = new Map<string, Tally>()
  const tally = (broker: string): Tally => {
    let t = tallies.get(broker)
    if (!t) {
      t = { buyQty: 0, buyAmt: 0, sellQty: 0, sellAmt: 0 }
      tallies.set(broker, t)
    }
    return t
  }

  for (const row of Array.isArray(buyRows) ? buyRows : []) {
    if (!row.buyer || typeof row.quantity !== "number") continue
    const t = tally(String(row.buyer))
    t.buyQty += row.quantity
    t.buyAmt += typeof row.amount === "number" ? row.amount : 0
  }
  for (const row of Array.isArray(sellRows) ? sellRows : []) {
    if (!row.seller || typeof row.quantity !== "number") continue
    const t = tally(String(row.seller))
    t.sellQty += row.quantity
    t.sellAmt += typeof row.amount === "number" ? row.amount : 0
  }
  return { tallies }
}

/** Last non-empty NEPSE-derived snapshot per symbol (used when today's
 * floorsheet is hidden during trading hours). Keyed by SYMBOL. */
const nepseSnapshotCache = new Map<string, { at: number; holding: BrokerFlow[]; selling: BrokerFlow[]; fromDate: string; toDate: string }>()

async function fetchBrokerHoldingViaNepse(
  clean: string,
  names: Map<string, string>,
): Promise<{ tallies: Map<string, Tally>; sheetRows: number; attributableRows: number }> {
  // Lazy import to avoid circular dependency at module load time; nepse.ts
  // does not import broker-holding.ts so a static import would also work,
  // but dynamic keeps the dependency explicit and avoids any init-order
  // surprises with the nepse-api-helper WASM token handshake.
  const { fetchSecurities, fetchFloorsheet } = await import("@/lib/nepse")

  const securities = await fetchSecurities()
  const match = securities.find((s) => s.symbol.toUpperCase() === clean)
  if (!match) throw new Error(`Security not found: ${clean}`)

  let sheet
  try {
    sheet = await fetchFloorsheet(match.id)
  } catch (err) {
    // Propagate as upstream error so the route returns 502 only when both
    // chukul (403) AND NEPSE (e.g. 401 token failure) are down.
    throw new Error(`NEPSE floorsheet unavailable for ${clean}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const tallies = new Map<string, Tally>()
  const tally = (broker: string): Tally => {
    let t = tallies.get(broker)
    if (!t) {
      t = { buyQty: 0, buyAmt: 0, sellQty: 0, sellAmt: 0 }
      tallies.set(broker, t)
    }
    return t
  }

  let attributableRows = 0
  for (const row of sheet.rows) {
    const qty = row.contractQuantity
    const amt = row.contractAmount
    if (!Number.isFinite(qty) || qty <= 0) continue
    // NEPSE hides buyer/seller during trading hours (empty string) — skip
    // those rows; they contribute no attributable broker flow.
    const hasBuyer = Boolean(row.buyerMemberId && String(row.buyerMemberId).trim())
    const hasSeller = Boolean(row.sellerMemberId && String(row.sellerMemberId).trim())
    if (hasBuyer || hasSeller) attributableRows++
    if (row.buyerMemberId) {
      const t = tally(String(row.buyerMemberId).trim())
      t.buyQty += qty
      t.buyAmt += Number.isFinite(amt) ? amt : qty * (Number.isFinite(row.contractRate) ? row.contractRate : 0)
    }
    if (row.sellerMemberId) {
      const t = tally(String(row.sellerMemberId).trim())
      t.sellQty += qty
      t.sellAmt += Number.isFinite(amt) ? amt : qty * (Number.isFinite(row.contractRate) ? row.contractRate : 0)
    }
  }

  return { tallies, sheetRows: sheet.rows.length, attributableRows }
}

function talliesToFlows(tallies: Map<string, Tally>, names: Map<string, string>): { holding: BrokerFlow[]; selling: BrokerFlow[] } {
  const holding: BrokerFlow[] = []
  const selling: BrokerFlow[] = []
  for (const [broker, t] of tallies) {
    const netQty = t.buyQty - t.sellQty
    if (netQty === 0) continue
    const buys = netQty > 0
    const grossQty = buys ? t.buyQty : t.sellQty
    const grossAmt = buys ? t.buyAmt : t.sellAmt
    const flow: BrokerFlow = {
      broker,
      brokerName: names.get(broker) ?? null,
      quantity: Math.abs(netQty),
      amount: Math.round(Math.abs(t.buyAmt - t.sellAmt) * 100) / 100,
      avgRate: grossQty > 0 ? Math.round((grossAmt / grossQty) * 100) / 100 : null,
    }
    ;(buys ? holding : selling).push(flow)
  }
  holding.sort((a, b) => b.quantity - a.quantity)
  selling.sort((a, b) => b.quantity - a.quantity)
  return { holding: holding.slice(0, 10), selling: selling.slice(0, 10) }
}

export async function fetchBrokerHolding(symbol: string, period: BrokerHoldingPeriod): Promise<BrokerHoldingData> {
  const clean = symbol.trim().toUpperCase()
  const days = period === "weekly" ? 7 : 30
  const fromDate = kathmanduDate(days)
  const toDate = kathmanduDate(0)
  const qs = `symbol=${encodeURIComponent(clean)}&from_date=${fromDate}&to_date=${toDate}`

  // Broker names are decorative; fetch in parallel and tolerate missing.
  const names = await fetchBrokerNames()

  // Try chukul's pre-aggregated window first — richer 7/30 day history when
  // the endpoint is public. Since Q4-2025 it 403s for anonymous callers, in
  // which case we fall through to the NEPSE floorsheet-derived path.
  try {
    const { tallies } = await fetchBrokerHoldingViaChukul(clean, qs, names)
    // If chukul returned at least one broker, trust it as the weekly/monthly
    // window. An empty tally with 200 is valid (no trades) — return it rather
    // than falling back and mixing semantics.
    const { holding, selling } = talliesToFlows(tallies, names)
    // Distinguish "chukul succeeded but market had no flow" (return empty
    // correctly) from "chukul succeeded but bug gave empty despite trades".
    // We already know chukul succeeded (no throw), so return its result even
    // if empty. The outer catch only handles thrown/403 cases.
    return { symbol: clean, period, fromDate, toDate, holding, selling }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Expected path after chukul gated the endpoints:
    //   "chukul.com responded 403 for /api/data/top-net-..."
    // Log at warn so operators can tell the fallback fired.
    console.warn(`[broker-holding] chukul primary failed for ${clean} (${period}): ${msg} — falling back to NEPSE floorsheet`)
  }

  // Fallback: derive from NEPSE today's floorsheet (intraday, today's tape).
  // Period distinction is kept for UI range display but quantity reflects
  // today's attributable broker flow only (NEPSE has no historical broker API).
  // During trading hours NEPSE anonymizes buyerMemberId/sellerMemberId (""),
  // giving a 0-attributable sheet despite hundreds of trades — in that case
  // we serve the last cached *visible* snapshot (after-close data) if one
  // exists and is less than 5 trading days old, otherwise return empty with
  // 200 (UI shows "No net accumulation" rather than a 502 error).
  const { tallies, sheetRows, attributableRows } = await fetchBrokerHoldingViaNepse(clean, names)
  let { holding, selling } = talliesToFlows(tallies, names)

  const isHidden = sheetRows > 0 && attributableRows === 0
  const hasFlow = holding.length > 0 || selling.length > 0

  if (hasFlow) {
    // Cache the visible result for the next hidden-window fallback.
    nepseSnapshotCache.set(clean, { at: Date.now(), holding, selling, fromDate, toDate })
  } else if (isHidden) {
    const cached = nepseSnapshotCache.get(clean)
    const fresh = cached && Date.now() - cached.at < 5 * 24 * 60 * 60_000
    if (fresh && (cached.holding.length > 0 || cached.selling.length > 0)) {
      console.warn(`[broker-holding] NEPSE sheet hidden for ${clean} (${sheetRows} trades, 0 attributable) — serving cached snapshot from ${cached.fromDate}–${cached.toDate}`)
      // Keep the cached broker flows but update the range metadata to the
      // requested period so the header dates remain correct.
      return { symbol: clean, period, fromDate, toDate, holding: cached.holding, selling: cached.selling }
    }
    // No cache yet (first request after server start during open hours) —
    // return empty gracefully; UI will show the "no attributable flow"
    // placeholder instead of a hard error.
    console.warn(`[broker-holding] NEPSE sheet hidden for ${clean} (${sheetRows} trades) — no cached snapshot, returning empty`)
  }

  return {
    symbol: clean,
    period,
    fromDate,
    toDate,
    holding,
    selling,
  }
}
