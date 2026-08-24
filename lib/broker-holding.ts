// ---------------------------------------------------------------------------
// Per-symbol broker holding / selling aggregates.
//
// PRIMARY (2026): nepsealpha.com's broker-holding/filter endpoint (historical
//   floorsheet aggregated over a true weekly/monthly window):
//   GET https://nepsealpha.com/broker-holding/filter?symbol=X&range=W|M
//     → { floor_sheet: {a:[], b:[], s:[], d:[], q:[]}, date_range: [from,to] }
//   where for each trade index i:
//     b[i] = buyer broker_no (string), s[i] = seller broker_no,
//     q[i] = quantity (Kitta), a[i] = amount (Rs), d[i] = date (YYYY-MM-DD)
//   range=W → weekly (~7 trading days), range=M → monthly (~30 days)
//   This endpoint is behind Cloudflare (cf-mitigated challenge) — plain
//   server-side fetch gets 403 "Just a moment...". We bypass via `cloudscraper`
//   (Node) which solves the challenge and returns JSON. Verified via
//   python/cloudscraper and Node cloudscraper 4.6.0 (see research).
//   Example verified: SKHEL M 2026-07-21–2026-08-23 → 2343 trades, W 481 trades.
//
// SECONDARY (legacy): chukul.com's public API:
//   GET /api/data/top-net-holding/?symbol=X&from_date=&to_date=  → buy rows
//   GET /api/data/top-net-release/?symbol=X&from_date=&to_date=  → sell rows
//   GET /api/broker/                                             → broker directory
//   Since late-2025 chukul gated holding/release behind Bearer auth
//   (403 {"detail":"Authentication credentials were not provided."}) — now
//   always 403 for anonymous callers. Broker directory remains public.
//
// TERTIARY FALLBACK: NEPSE official floorsheet (intraday today only) via
//   lib/nepse.ts → POST /api/nots/nepse-data/floorsheet?stockId=
//   Aggregates today's tape by buyerMemberId/sellerMemberId. During market
//   hours NEPSE anonymizes brokers (""), so we cache the last visible
//   after-close snapshot (<5 days) and serve it while hidden.
//
//   Holding  = buyQty - sellQty > 0 ; Selling = sellQty - buyQty > 0
// ---------------------------------------------------------------------------

const CHUKUL_BASE = "https://chukul.com"
const NEPSEALPHA_BASE = "https://nepsealpha.com"

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://chukul.com/brokers-analytics",
}

const NEPSEALPHA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://nepsealpha.com/broker-holding?symbol=SKHEL",
  "X-Requested-With": "XMLHttpRequest",
}

export type BrokerHoldingPeriod = "daily" | "weekly" | "monthly"

export type BrokerFlow = {
  broker: string
  brokerName: string | null
  quantity: number
  amount: number
  avgRate: number | null
}

export type BrokerHoldingData = {
  symbol: string
  period: BrokerHoldingPeriod
  fromDate: string
  toDate: string
  holding: BrokerFlow[]
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

type NepseAlphaFilterResponse = {
  floor_sheet?: {
    a?: number[]
    b?: (string | number)[]
    s?: (string | number)[]
    d?: string[]
    q?: number[]
  }
  date_range?: [string, string]
}

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

function kathmanduHour(): number {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" })).getHours()
}

function isWeekendKathmandu(dateStr: string): boolean {
  // NEPSE trades Mon-Fri (per app footer). Sat/Sun are weekend.
  const d = new Date(`${dateStr}T00:00:00`)
  const w = d.getDay() // 0 Sun, 6 Sat
  return w === 0 || w === 6
}

/** Last trading day before `today` (Kathmandu) that appears in `availableDates` if provided, else calendar previous weekday. */
function getLastTradingDay(today: string, availableDates?: string[]): string {
  if (availableDates && availableDates.length > 0) {
    const sorted = [...new Set(availableDates)].sort()
    // Find the most recent date < today
    let candidate: string | null = null
    for (const d of sorted) {
      if (d < today) candidate = d
    }
    if (candidate) return candidate
    // If no date < today (e.g., today is earliest), return latest available
    return sorted[sorted.length - 1]
  }
  // Fallback calendar: go back 1..7 days until weekday Mon-Fri
  for (let i = 1; i <= 7; i++) {
    const cand = kathmanduDate(i)
    const w = new Date(`${cand}T00:00:00`).getDay()
    if (w !== 0 && w !== 6) return cand
  }
  return kathmanduDate(1)
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
    // decorative
  }
  brokerNamesCache = { at: Date.now(), map }
  return map
}

type Tally = { buyQty: number; buyAmt: number; sellQty: number; sellAmt: number }

// ---------------------------------------------------------------------------
// NepseAlpha primary: uses cloudscraper to bypass Cloudflare
// ---------------------------------------------------------------------------
async function fetchBrokerHoldingViaNepseAlpha(
  clean: string,
  period: BrokerHoldingPeriod,
  names: Map<string, string>
): Promise<{ holding: BrokerFlow[]; selling: BrokerFlow[]; fromDate: string; toDate: string }> {
  const range = period === "daily" ? "D" : period === "weekly" ? "W" : "M"
  const url = `${NEPSEALPHA_BASE}/broker-holding/filter?symbol=${encodeURIComponent(clean)}&range=${range}`

  // Cloudscraper is Node-only (uses `request` + JS challenge solver). Dynamically
  // require it so the module can still be imported in edge/test environments
  // where it isn't installed — fallback will then trigger.
  let body: string
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cloudscraper: { get: (url: string, opts?: unknown) => Promise<string> } = require("cloudscraper")
    body = await cloudscraper.get(url, {
      headers: {
        ...NEPSEALPHA_HEADERS,
        Referer: `https://nepsealpha.com/broker-holding?symbol=${encodeURIComponent(clean)}`,
      },
      timeout: 15000,
    })
  } catch (err) {
    throw new Error(`nepsealpha cloudscraper failed for ${clean} ${period}: ${err instanceof Error ? err.message : String(err)}`)
  }

  let data: NepseAlphaFilterResponse
  try {
    data = JSON.parse(body) as NepseAlphaFilterResponse
  } catch {
    // If still HTML challenge page, surface as error to trigger fallback
    if (body.includes("Just a moment") || body.includes("_cf_chl_opt")) {
      throw new Error(`nepsealpha returned Cloudflare challenge for ${clean} ${period}`)
    }
    throw new Error(`nepsealpha returned non-JSON for ${clean} ${period}: ${body.slice(0, 200)}`)
  }

  const fs = data.floor_sheet
  if (!fs || !Array.isArray(fs.a) || !Array.isArray(fs.b) || !Array.isArray(fs.s) || !Array.isArray(fs.q)) {
    throw new Error(`nepsealpha missing floor_sheet arrays for ${clean} ${period}`)
  }

  // For daily we need to pick a single target date: today after close, else last trading day.
  let targetDailyDate: string | null = null
  if (period === "daily") {
    const today = kathmanduDate(0)
    const hour = kathmanduHour()
    const isTradingHour = hour >= 11 && hour < 15 && !isWeekendKathmandu(today)
    const uniqueDates = [...new Set((fs.d || []) as string[])].sort()
    if (isTradingHour) {
      targetDailyDate = getLastTradingDay(today, uniqueDates)
    } else {
      if (uniqueDates.includes(today)) targetDailyDate = today
      else targetDailyDate = getLastTradingDay(today, uniqueDates)
    }
    // If still null (no dates), fallback to today
    if (!targetDailyDate) targetDailyDate = today
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

  const n = fs.a.length
  for (let i = 0; i < n; i++) {
    // Daily: only include trades for the target date
    if (period === "daily" && targetDailyDate) {
      const d = fs.d?.[i]
      if (d !== targetDailyDate) continue
    }
    const buyer = fs.b[i] != null ? String(fs.b[i]).trim() : ""
    const seller = fs.s[i] != null ? String(fs.s[i]).trim() : ""
    const qty = typeof fs.q[i] === "number" ? fs.q[i] : Number(fs.q[i])
    const amt = typeof fs.a[i] === "number" ? fs.a[i] : Number(fs.a[i])
    if (!Number.isFinite(qty) || qty <= 0) continue
    const safeAmt = Number.isFinite(amt) ? amt : 0
    if (buyer) {
      const t = tally(buyer)
      t.buyQty += qty
      t.buyAmt += safeAmt
    }
    if (seller) {
      const t = tally(seller)
      t.sellQty += qty
      t.sellAmt += safeAmt
    }
  }

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

  // Use nepsealpha's date_range when provided, else fallback to computed.
  // For daily, fromDate/toDate are the single target date (today or last trading day).
  let fromDate: string
  let toDate: string
  if (period === "daily" && targetDailyDate) {
    fromDate = targetDailyDate
    toDate = targetDailyDate
  } else if (Array.isArray(data.date_range) && data.date_range.length === 2) {
    fromDate = data.date_range[0]
    toDate = data.date_range[1]
  } else {
    const days = period === "weekly" ? 7 : 30
    fromDate = kathmanduDate(days)
    toDate = kathmanduDate(0)
  }

  return {
    holding: holding.slice(0, 10),
    selling: selling.slice(0, 10),
    fromDate,
    toDate,
  }
}

async function fetchBrokerHoldingViaChukul(
  clean: string,
  qs: string,
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
): Promise<{ tallies: Map<string, Tally>; sheetRows: number; attributableRows: number }> {
  const { fetchSecurities, fetchFloorsheet } = await import("@/lib/nepse")

  const securities = await fetchSecurities()
  const match = securities.find((s) => s.symbol.toUpperCase() === clean)
  if (!match) throw new Error(`Security not found: ${clean}`)

  let sheet
  try {
    sheet = await fetchFloorsheet(match.id)
  } catch (err) {
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
  let fromDateFallback: string
  let toDateFallback: string
  let qs: string
  if (period === "daily") {
    const today = kathmanduDate(0)
    const hour = kathmanduHour()
    const isTradingHour = hour >= 11 && hour < 15 && !isWeekendKathmandu(today)
    let target: string
    if (isTradingHour) {
      target = getLastTradingDay(today)
    } else {
      target = isWeekendKathmandu(today) ? getLastTradingDay(today) : today
    }
    fromDateFallback = target
    toDateFallback = target
    qs = `symbol=${encodeURIComponent(clean)}&from_date=${fromDateFallback}&to_date=${toDateFallback}`
  } else {
    const days = period === "weekly" ? 7 : 30
    fromDateFallback = kathmanduDate(days)
    toDateFallback = kathmanduDate(0)
    qs = `symbol=${encodeURIComponent(clean)}&from_date=${fromDateFallback}&to_date=${toDateFallback}`
  }

  const names = await fetchBrokerNames()

  // 1) PRIMARY: nepsealpha (true weekly/monthly historical, Cloudflare-bypassed)
  try {
    const alpha = await fetchBrokerHoldingViaNepseAlpha(clean, period, names)
    // alpha already sliced to 10 and has correct date_range
    console.log(`[broker-holding] nepsealpha hit for ${clean} ${period}: ${alpha.holding.length} holding / ${alpha.selling.length} selling (${alpha.fromDate}→${alpha.toDate})`)
    return { symbol: clean, period, fromDate: alpha.fromDate, toDate: alpha.toDate, holding: alpha.holding, selling: alpha.selling }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[broker-holding] nepsealpha failed for ${clean} ${period}: ${msg} — falling back to chukul`)
  }

  // 2) SECONDARY: chukul (now 403, but keep for future if re-opened)
  try {
    const { tallies } = await fetchBrokerHoldingViaChukul(clean, qs)
    const { holding, selling } = talliesToFlows(tallies, names)
    return { symbol: clean, period, fromDate: fromDateFallback, toDate: toDateFallback, holding, selling }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[broker-holding] chukul failed for ${clean} ${period}: ${msg} — falling back to NEPSE`)
  }

  // 3) TERTIARY: NEPSE intraday floorsheet (today only)
  const { tallies, sheetRows, attributableRows } = await fetchBrokerHoldingViaNepse(clean)
  let { holding, selling } = talliesToFlows(tallies, names)

  const cacheKey = `${clean}:${period}`
  const isHidden = sheetRows > 0 && attributableRows === 0
  const hasFlow = holding.length > 0 || selling.length > 0

  if (hasFlow) {
    nepseSnapshotCache.set(cacheKey, { at: Date.now(), holding, selling, fromDate: fromDateFallback, toDate: toDateFallback })
  } else if (isHidden) {
    const cached = nepseSnapshotCache.get(cacheKey)
    const fresh = cached && Date.now() - cached.at < 5 * 24 * 60 * 60_000
    if (fresh && (cached.holding.length > 0 || cached.selling.length > 0)) {
      console.warn(`[broker-holding] NEPSE hidden for ${clean} (${sheetRows} trades) — serving cached snapshot from ${cached.fromDate}→${cached.toDate}`)
      return { symbol: clean, period, fromDate: fromDateFallback, toDate: toDateFallback, holding: cached.holding, selling: cached.selling }
    }
    console.warn(`[broker-holding] NEPSE hidden for ${clean} (${sheetRows} trades) — no cache, returning empty`)
  }

  return { symbol: clean, period, fromDate: fromDateFallback, toDate: toDateFallback, holding, selling }
}
