import {
  initialize,
  getSecurities,
  getSecurityDetail,
  createHeaders,
  type MarketStatus,
  type SecurityBrief,
  type SecurityDetail,
  type IndexDetail,
} from "nepse-api-helper"
import { getProveObject, generateValidToken } from "nepse-api-helper/dist/auth"
import { getHardCodedNepseExports } from "nepse-api-helper/dist/nepseExports"
import { computePhase, recordPhase, getPhase, newestRowStamp } from "@/lib/feed-clock"

/**
 * Server-side NEPSE client wrapper.
 *
 * - Initializes the underlying nepse-api-helper client exactly once per
 *   server process (handles the WASM token-deobfuscation handshake).
 * - Adds an in-memory response cache with per-endpoint TTLs so we don't
 *   hammer NEPSE's servers (their tokens expire every ~60s anyway).
 * - Normalizes errors into a consistent shape for route handlers.
 */

// ---------------------------------------------------------------------------
// One-time initialization (shared promise so concurrent requests don't race)
// ---------------------------------------------------------------------------

let initPromise: Promise<void> | null = null

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initialize({
      // Try the live WASM module first; the library automatically falls back
      // to its bundled TypeScript implementation if the fetch fails.
      useWasm: true,
      logger: {
        info: () => {},
        warn: (msg, ...args) => console.warn(`[nepse] ${msg}`, ...args),
        error: (msg, ...args) => console.error(`[nepse] ${msg}`, ...args),
      },
    }).catch((err) => {
      // Reset so the next request can retry initialization.
      initPromise = null
      throw err
    })
  }
  return initPromise
}

// ---------------------------------------------------------------------------
// Simple in-memory TTL cache with stale-on-error fallback
// ---------------------------------------------------------------------------

type CacheEntry<T> = { data: T; expiry: number }

const cache = new Map<string, CacheEntry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const entry = cache.get(key) as CacheEntry<T> | undefined

  if (entry && entry.expiry > now) {
    return entry.data
  }

  // Deduplicate concurrent requests for the same key.
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) {
    return existing
  }

  const promise = (async () => {
    try {
      await ensureInitialized()
      const data = await fetcher()
      cache.set(key, { data, expiry: Date.now() + ttlMs })
      return data
    } catch (err) {
      // Serve stale data if we have any — NEPSE breaks often enough that
      // slightly outdated data beats an error page.
      if (entry) {
        console.warn(`[nepse] fetch failed for "${key}", serving stale data`, err)
        return entry.data
      }
      throw err
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

/**
 * Phase-locked variant of `cached` for NEPSE's minute-published snapshots.
 *
 * Instead of a flat TTL, the expiry is derived from the payload's OWN generation
 * time: coast to just before the next expected publish boundary, then re-check
 * every ~400ms until the timestamp actually advances. See lib/feed-clock.ts for
 * the measurements that motivated this — a flat TTL let a snapshot go 74s stale
 * because our polls drifted out of phase with upstream's once-a-minute publish.
 *
 * `extractStamp` pulls the feed's own timestamp out of the payload. Feeds with
 * no timestamp of their own pass null and ride the shared market clock.
 */
async function cachedLive<T>(
  key: string,
  fetcher: () => Promise<T>,
  extractStamp: (data: T) => string | null,
): Promise<T> {
  const now = Date.now()
  const entry = cache.get(key) as CacheEntry<T> | undefined

  if (entry && entry.expiry > now) {
    return entry.data
  }

  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) {
    return existing
  }

  const promise = (async () => {
    try {
      await ensureInitialized()
      const data = await fetcher()

      // Record when this snapshot first showed up; stamped feeds also drive the
      // shared phase that stamp-less feeds ride. getPhase falls back to shared.
      const fetchedAt = Date.now()
      recordPhase(key, extractStamp(data), fetchedAt)

      const { expiry } = computePhase(fetchedAt, getPhase(key))
      cache.set(key, { data, expiry })
      return data
    } catch (err) {
      if (entry) {
        console.warn(`[nepse] fetch failed for "${key}", serving stale data`, err)
        return entry.data
      }
      throw err
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

// ---------------------------------------------------------------------------
// Public API — each returns cached data with an endpoint-appropriate TTL
// ---------------------------------------------------------------------------

/**
 * Flat TTL for real-time feeds that are NOT phase-locked — order book and
 * floorsheet data, which react to individual trades rather than to the
 * once-a-minute snapshot, so there is no boundary to lock onto.
 */
const LIVE_TTL = 1_000

const TTL = {
  /** Market open/close status changes rarely; 60s is plenty. */
  marketStatus: 60_000,
  /** The full securities list barely changes intraday. */
  securities: 10 * 60_000,
  /**
   * Per-symbol quote / order book / floorsheet — trade-driven, not snapshot
   * driven, so these stay on a flat TTL rather than phase-locking.
   */
  securityDetail: LIVE_TTL,
  /** Company disclosures — cheap, low churn. */
  summary: LIVE_TTL,
  /**
   * Intraday graph points. NEPSE only appends one point per minute, so a
   * sub-second TTL here would just hammer upstream for identical arrays.
   */
  graph: 15_000,
} as const

// ---------------------------------------------------------------------------
// Raw authenticated GETs against NEPSE endpoints the helper doesn't wrap
// ---------------------------------------------------------------------------

const NEPSE_BASE = "https://nepalstock.com.np"

// ---------------------------------------------------------------------------
// Local token management.
//
// nepse-api-helper caches its token for 5 minutes (TOKEN_TTL_MS), but NEPSE
// actually invalidates tokens after roughly a minute — so its getToken()
// happily serves stale tokens and every raw request starts failing with 401.
// We instead mint tokens ourselves via the library's exported auth helpers,
// keep them for a conservative 40s, and force-refresh + retry once on 401.
// ---------------------------------------------------------------------------

const LOCAL_TOKEN_TTL_MS = 40_000

/**
 * salts[0..4] = salt1..salt5 from the prove object. NEPSE's salted POST
 * endpoints (index graphs, floorsheet) derive their body id from these,
 * so we keep the salts that belong to the currently active token.
 */
let localToken: { value: string; salts: number[]; expiry: number } | null = null
let tokenInflight: Promise<string> | null = null

async function getFreshToken(force = false): Promise<string> {
  const now = Date.now()
  if (!force && localToken && now < localToken.expiry) {
    return localToken.value
  }
  if (!tokenInflight) {
    tokenInflight = (async () => {
      try {
        const proveObj = await getProveObject()
        const token = generateValidToken(proveObj, getHardCodedNepseExports())
        const p = proveObj as unknown as Record<string, number>
        localToken = {
          value: token,
          salts: [p.salt1, p.salt2, p.salt3, p.salt4, p.salt5],
          expiry: Date.now() + LOCAL_TOKEN_TTL_MS,
        }
        return token
      } finally {
        tokenInflight = null
      }
    })()
  }
  return tokenInflight
}

/** Authenticated fetch that force-refreshes the token and retries once on 401. */
async function authedFetch(path: string, init?: Omit<RequestInit, "headers">): Promise<Response> {
  const doFetch = async (token: string) =>
    fetch(`${NEPSE_BASE}${path}`, {
      ...init,
      headers: {
        ...(createHeaders(token) as Record<string, string>),
        ...(init?.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    })

  let res = await doFetch(await getFreshToken())
  if (res.status === 401) {
    console.warn(`[nepse] 401 on ${path}, refreshing token and retrying`)
    res = await doFetch(await getFreshToken(true))
  }
  return res
}

async function rawGet<T>(path: string): Promise<T> {
  const res = await authedFetch(path)
  if (!res.ok) {
    throw new Error(`NEPSE request failed: ${res.status} ${res.statusText} (${path})`)
  }
  return (await res.json()) as T
}

/**
 * NEPSE's POST endpoints require a "body id" derived from a hardcoded lookup
 * table, the current market id, and today's date in Nepal — replicating the
 * obfuscation their Angular frontend performs. (Same table nepse-api-helper
 * uses internally for getSecurityDetail.)
 */
const BODY_ID_TABLE = [
  147, 117, 239, 143, 157, 312, 161, 612, 512, 804, 411, 527, 170, 511, 421, 667, 764, 621, 301, 106, 133, 793, 411,
  511, 312, 423, 344, 346, 653, 758, 342, 222, 236, 811, 711, 611, 122, 447, 128, 199, 183, 135, 489, 703, 800, 745,
  152, 863, 134, 211, 142, 564, 375, 793, 212, 153, 138, 153, 648, 611, 151, 649, 318, 143, 117, 756, 119, 141, 717,
  113, 112, 146, 162, 660, 693, 261, 362, 354, 251, 641, 157, 178, 631, 192, 734, 445, 192, 883, 187, 122, 591, 731,
  852, 384, 565, 596, 451, 772, 624, 691,
]

function nepalDay(): number {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" })).getDate()
}

async function computeBodyId(): Promise<number> {
  const status = await fetchMarketStatus()
  return BODY_ID_TABLE[status.id] + status.id + 2 * nepalDay()
}

/**
 * Salted body id for graph/floorsheet POST endpoints. These reject the plain
 * body id (401) and instead expect it mixed with two of the five salts that
 * came with the current access token — mirroring NEPSE's Angular frontend.
 *   graph:      saltIndex = e % 10 < 5 ? 3 : 1
 *   floorsheet: saltIndex = e % 10 < 4 ? 1 : 3
 */
async function computeSaltedBodyId(kind: "graph" | "floorsheet"): Promise<number> {
  const e = await computeBodyId()
  // Make sure a token (and its salts) is active.
  await getFreshToken()
  const salts = localToken?.salts
  if (!salts || salts.some((s) => typeof s !== "number")) {
    throw new Error("NEPSE auth salts unavailable")
  }
  const day = nepalDay()
  const saltIndex = kind === "graph" ? (e % 10 < 5 ? 3 : 1) : e % 10 < 4 ? 1 : 3
  return e + salts[saltIndex] * day - salts[saltIndex - 1]
}

async function rawPost<T>(path: string, salted?: "graph" | "floorsheet"): Promise<T | null> {
  const bodyId = salted ? await computeSaltedBodyId(salted) : await computeBodyId()
  const res = await authedFetch(path, {
    method: "POST",
    body: JSON.stringify({ id: bodyId }),
  })
  if (!res.ok) {
    throw new Error(`NEPSE request failed: ${res.status} ${res.statusText} (${path})`)
  }
  const text = await res.text()
  if (!text) return null
  return JSON.parse(text) as T
}

export type MarketSummaryItem = { detail: string; value: number }

export type LiveSecurity = {
  securityId: string
  securityName: string
  symbol: string
  indexId: number
  totalTradeQuantity: number
  lastTradedPrice: number
  percentageChange: number
  previousClose: number
  closePrice: number | null
}

export type TopMover = {
  symbol: string
  ltp: number
  pointChange: number
  percentageChange: number
  securityName: string
  securityId: number
}

export type TopTurnoverItem = {
  symbol: string
  turnover: number
  closingPrice: number
  securityName: string
  securityId: number
}

export type TopTradeItem = {
  symbol: string
  shareTraded: number
  closingPrice: number
  securityName: string
  securityId: number
}

export type SubIndex = {
  id: number
  index: string
  change: number
  perChange: number
  currentValue: number
}

/** [epochSeconds, indexValue] pairs for the current trading day. */
export type GraphPoint = [number, number]

export function fetchMarketSummary(): Promise<MarketSummaryItem[]> {
  // No timestamp of its own — rides the shared market clock (see feed-clock.ts).
  return cachedLive("market-summary", () => rawGet<MarketSummaryItem[]>("/api/nots/market-summary/"), () => null)
}

/**
 * Live trade stats. `indexId` 58 is the whole market (NEPSE index); passing a
 * sub-index id (e.g. 54 = HydroPower) returns only that sector's securities.
 */
export function fetchLiveMarket(indexId = 58): Promise<LiveSecurity[]> {
  return cachedLive(
    `live-market:${indexId}`,
    () => rawGet<LiveSecurity[]>(`/api/nots/securityDailyTradeStat/${indexId}`),
    () => null,
  )
}

/**
 * Full live-market rows from /api/nots/lives-market — the same endpoint
 * nepalstock.com/live-market uses. Unlike securityDailyTradeStat, it includes
 * open/high/low, last traded volume (LTV), average traded price and turnover.
 */
export type LiveMarketRow = {
  securityId: string
  securityName: string
  symbol: string
  indexId: number
  openPrice: number
  highPrice: number
  lowPrice: number
  totalTradeQuantity: number
  totalTradeValue: number
  lastTradedPrice: number
  percentageChange: number
  lastUpdatedDateTime: string
  lastTradedVolume: number | null
  previousClose: number
  averageTradedPrice: number
}

/**
 * Row shape of /api/nots/nepse-data/today-price — the "Today's Price" page.
 * Unlike lives-market (which goes EMPTY the moment the session ends), this
 * endpoint keeps serving the latest business day's closed data after hours,
 * which is what TMS-style boards display when the market is over.
 */
type TodayPriceRow = {
  securityId: number
  securityName: string
  symbol: string
  openPrice: number
  highPrice: number
  lowPrice: number
  closePrice: number | null
  totalTradedQuantity: number
  totalTradedValue: number
  previousDayClosePrice: number
  lastUpdatedTime: string
  lastUpdatedPrice: number
  averageTradedPrice: number
  businessDate: string
}

type TodayPricePage = { content: TodayPriceRow[]; last: boolean; totalPages: number }

async function fetchTodaysClose(): Promise<LiveMarketRow[]> {
  const rows: TodayPriceRow[] = []
  // today-price is a POST endpoint guarded by the floorsheet-style salted body
  // id (a plain GET silently returns []). ~340 scrips fit in one 500-row page;
  // loop defensively in case NEPSE caps the page size lower than requested.
  for (let page = 0; page < 5; page++) {
    const res = await rawPost<TodayPricePage | TodayPriceRow[]>(
      `/api/nots/nepse-data/today-price?page=${page}&size=500&businessDate=`,
      "floorsheet",
    )
    if (!res) break
    if (Array.isArray(res)) {
      rows.push(...res)
      break
    }
    if (!Array.isArray(res.content)) break
    rows.push(...res.content)
    if (res.last || res.content.length === 0) break
  }
  return rows.map((r) => {
    const ltp = r.closePrice ?? r.lastUpdatedPrice
    const prev = r.previousDayClosePrice
    return {
      securityId: String(r.securityId),
      securityName: r.securityName,
      symbol: r.symbol,
      indexId: 0,
      openPrice: r.openPrice,
      highPrice: r.highPrice,
      lowPrice: r.lowPrice,
      totalTradeQuantity: r.totalTradedQuantity,
      totalTradeValue: r.totalTradedValue,
      lastTradedPrice: ltp,
      percentageChange: prev ? Number((((ltp - prev) / prev) * 100).toFixed(2)) : 0,
      lastUpdatedDateTime: r.lastUpdatedTime,
      lastTradedVolume: null,
      previousClose: prev,
      averageTradedPrice: r.averageTradedPrice,
    } satisfies LiveMarketRow
  })
}

/**
 * Last non-empty lives-market snapshot, held in memory. lives-market goes
 * EMPTY the instant the session ends, so this snapshot — captured while the
 * market was still open — IS the day's closing data, complete with OHLC, LTV
 * and last-traded times. It is only ever replaced by a newer non-empty
 * snapshot (i.e. the next session's trades), never cleared.
 */
let lastLiveSnapshot: LiveMarketRow[] | null = null

/**
 * Final after-hours fallback when the server (re)started after the close and
 * has no in-memory snapshot, and today-price hasn't been published yet:
 * securityDailyTradeStat keeps serving LTP/close, previous close, %change and
 * volume after hours. It lacks OHLC/turnover/avg — those render as "—".
 */
async function fetchDailyStatClose(): Promise<LiveMarketRow[]> {
  const stats = await fetchLiveMarket(58)
  return stats.map((s) => ({
    securityId: s.securityId,
    securityName: s.securityName,
    symbol: s.symbol,
    indexId: s.indexId,
    openPrice: Number.NaN,
    highPrice: Number.NaN,
    lowPrice: Number.NaN,
    totalTradeQuantity: s.totalTradeQuantity,
    totalTradeValue: Number.NaN,
    lastTradedPrice: s.closePrice ?? s.lastTradedPrice,
    percentageChange: s.percentageChange,
    lastUpdatedDateTime: "",
    lastTradedVolume: null,
    previousClose: s.previousClose,
    averageTradedPrice: Number.NaN,
  }))
}

export async function fetchLivesMarket(): Promise<LiveMarketRow[]> {
  const live = await cachedLive("lives-market", () => rawGet<LiveMarketRow[]>("/api/nots/lives-market"), newestRowStamp)
  if (live.length > 0) {
    lastLiveSnapshot = live
    return live
  }

  // Session over — lives-market publishes only while trading, so serve the
  // day's closed data instead of an empty board (like every TMS does).

  // 1. Best source: NEPSE's official "Today's Price" endpoint — the same data
  //    nepalstock.com/today-price shows, with the OFFICIAL close prices (which
  //    can differ from the raw last-traded price in the final live snapshot).
  const todayClose = await cached("today-price-close", 60_000, fetchTodaysClose).catch(() => [] as LiveMarketRow[])
  if (todayClose.length > 0) return todayClose

  // 2. Today's Price EOD batch not published yet: the final live snapshot we
  //    captured before the feed went empty IS the day's closing data.
  if (lastLiveSnapshot) return lastLiveSnapshot

  // 3. Last resort: daily trade stats, which keep serving close/prev-close/
  //    volume after hours (no OHLC — rendered as "—" client-side).
  return cached("daily-stat-close", 60_000, fetchDailyStatClose)
}

export type TopTransactionItem = {
  symbol: string
  totalTrades: number
  lastTradedPrice: number
  securityName: string
  securityId: number
}

export type TopItem = TopMover | TopTurnoverItem | TopTradeItem | TopTransactionItem

const TOP_PATHS = {
  gainer: "top-gainer",
  loser: "top-loser",
  turnover: "turnover",
  trade: "trade",
  transaction: "transaction",
} as const

export type TopType = keyof typeof TOP_PATHS

export function isTopType(value: string): value is TopType {
  return value in TOP_PATHS
}

/**
 * Fetches a top-ten list. With `all=true` NEPSE returns the full ranked list
 * (every traded security), which we use for sector filtering and scrollable
 * lists on the client.
 */
export function fetchTopList(type: TopType, all = true): Promise<TopItem[]> {
  return cachedLive(
    `top-${type}:${all}`,
    () => rawGet<TopItem[]>(`/api/nots/top-ten/${TOP_PATHS[type]}?all=${all}`),
    () => null,
  )
}

/**
 * Top list restricted to one sector sub-index. NEPSE's top-ten endpoints are
 * market-wide only, so we intersect the full ranked list with the sector's
 * own live-trade-stat list (securityDailyTradeStat/{indexId}).
 */
export async function fetchTopListForIndex(type: TopType, indexId: number): Promise<TopItem[]> {
  const [list, sectorLive] = await Promise.all([fetchTopList(type, true), fetchLiveMarket(indexId)])
  const idsInSector = new Set(sectorLive.map((s) => Number(s.securityId)))
  return list.filter((item) => idsInSector.has(item.securityId))
}

// ---------------------------------------------------------------------------
// Per-company data: full detail, market depth, floorsheet, intraday graph
// ---------------------------------------------------------------------------

export type CompanyDetail = {
  securityId: number
  symbol: string
  securityName: string
  sector: string | null
  instrumentType: string | null
  permittedToTrade: boolean
  activeStatus: string
  listingDate: string | null
  email: string | null
  website: string | null
  asOf: string | null
  openPrice: number | null
  highPrice: number | null
  lowPrice: number | null
  lastTradedPrice: number | null
  previousClose: number | null
  closePrice: number | null
  totalTradeQuantity: number | null
  totalTrades: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  stockListedShares: number | null
  paidUpCapital: number | null
  marketCapitalization: number | null
  promoterShares: number | null
  promoterPercentage: number | null
  publicShares: number | null
  publicPercentage: number | null
  ownershipUpdatedDate: string | null
}

type RawCompanyPayload = {
  securityDailyTradeDto?: {
    openPrice?: number
    highPrice?: number
    lowPrice?: number
    totalTradeQuantity?: number
    totalTrades?: number
    lastTradedPrice?: number
    previousClose?: number
    businessDate?: string
    closePrice?: number
    fiftyTwoWeekHigh?: number
    fiftyTwoWeekLow?: number
  }
  security?: {
    id?: number
    symbol?: string
    securityName?: string
    permittedToTrade?: string
    activeStatus?: string
    listingDate?: string
    instrumentType?: { code?: string; description?: string }
    companyId?: {
      email?: string
      companyWebsite?: string
      sectorMaster?: { sectorDescription?: string }
    }
  }
  stockListedShares?: number
  paidUpCapital?: number
  marketCapitalization?: number
  publicShares?: number
  publicPercentage?: number
  promoterShares?: number
  promoterPercentage?: number
  updatedDate?: string
}

export function fetchCompanyDetail(securityId: number): Promise<CompanyDetail> {
  return cached(`company:${securityId}`, TTL.securityDetail, async () => {
    const raw = await rawPost<RawCompanyPayload>(`/api/nots/security/${securityId}`)
    if (!raw) throw new Error(`Empty company payload for security ${securityId}`)
    const t = raw.securityDailyTradeDto
    const s = raw.security
    return {
      securityId,
      symbol: s?.symbol ?? "",
      securityName: s?.securityName ?? "",
      sector: s?.companyId?.sectorMaster?.sectorDescription ?? null,
      instrumentType:
        s?.instrumentType?.description && s?.instrumentType?.code
          ? `${s.instrumentType.description} (${s.instrumentType.code})`
          : (s?.instrumentType?.description ?? null),
      permittedToTrade: s?.permittedToTrade === "Y",
      activeStatus: s?.activeStatus === "A" ? "Active" : (s?.activeStatus ?? ""),
      listingDate: s?.listingDate ?? null,
      email: s?.companyId?.email ?? null,
      website: s?.companyId?.companyWebsite ?? null,
      asOf: t?.businessDate ?? null,
      openPrice: t?.openPrice ?? null,
      highPrice: t?.highPrice ?? null,
      lowPrice: t?.lowPrice ?? null,
      lastTradedPrice: t?.lastTradedPrice ?? null,
      previousClose: t?.previousClose ?? null,
      closePrice: t?.closePrice ?? null,
      totalTradeQuantity: t?.totalTradeQuantity ?? null,
      totalTrades: t?.totalTrades ?? null,
      fiftyTwoWeekHigh: t?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: t?.fiftyTwoWeekLow ?? null,
      stockListedShares: raw.stockListedShares ?? null,
      paidUpCapital: raw.paidUpCapital ?? null,
      marketCapitalization: raw.marketCapitalization ?? null,
      promoterShares: raw.promoterShares ?? null,
      promoterPercentage: raw.promoterPercentage ?? null,
      publicShares: raw.publicShares ?? null,
      publicPercentage: raw.publicPercentage ?? null,
      ownershipUpdatedDate: raw.updatedDate ?? null,
    } satisfies CompanyDetail
  })
}

export type DepthLevel = { orderBookOrderPrice: number; quantity: number; orderCount: number }

export type MarketDepth = {
  buy: DepthLevel[]
  sell: DepthLevel[]
  totalBuyQty: number
  totalSellQty: number
} | null

type RawDepthPayload = {
  marketDepth?: { buyMarketDepthList?: DepthLevel[]; sellMarketDepthList?: DepthLevel[] }
  totalBuyQty?: number
  totalSellQty?: number
}

/** Returns null outside trading hours — NEPSE clears the order book at close. */
export function fetchMarketDepth(securityId: number): Promise<MarketDepth> {
  return cached(`depth:${securityId}`, TTL.securityDetail, async () => {
    const res = await authedFetch(`/api/nots/nepse-data/marketdepth/${securityId}`)
    if (!res.ok) throw new Error(`NEPSE market depth failed: ${res.status}`)
    const text = await res.text()
    if (!text) return null
    const raw = JSON.parse(text) as RawDepthPayload
    return {
      buy: raw.marketDepth?.buyMarketDepthList ?? [],
      sell: raw.marketDepth?.sellMarketDepthList ?? [],
      totalBuyQty: raw.totalBuyQty ?? 0,
      totalSellQty: raw.totalSellQty ?? 0,
    }
  })
}

export type FloorsheetRow = {
  contractId: number
  stockSymbol: string
  buyerMemberId: string
  sellerMemberId: string
  contractQuantity: number
  contractRate: number
  contractAmount: number
  tradeTime: string | null
}

export type FloorsheetData = {
  rows: FloorsheetRow[]
  totalQty: number
  totalAmount: number
  totalTrades: number
}

type RawFloorsheetRow = Record<string, unknown>

type RawFloorsheetPayload =
  | {
      totalAmount?: number
      totalQty?: number
      totalTrades?: number
      floorsheets?: { content?: RawFloorsheetRow[]; totalElements?: number; last?: boolean }
      content?: RawFloorsheetRow[]
    }
  | RawFloorsheetRow[]

function firstValue(row: RawFloorsheetRow, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key]
  }
  return undefined
}

function finiteNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value.replaceAll(",", "")) : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeFloorsheetRow(source: RawFloorsheetRow): FloorsheetRow {
  const nested = source.floorsheet
  const row = nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as RawFloorsheetRow) : source
  const quantity = finiteNumber(firstValue(row, ["contractQuantity", "quantity", "tradeQuantity"]))
  const rate = finiteNumber(firstValue(row, ["contractRate", "rate", "tradePrice", "price"]))

  return {
    contractId: finiteNumber(firstValue(row, ["contractId", "contractNo", "id"])),
    stockSymbol: String(firstValue(row, ["stockSymbol", "symbol"]) ?? ""),
    buyerMemberId: String(firstValue(row, ["buyerMemberId", "buyerBroker", "buyerBrokerId"]) ?? ""),
    sellerMemberId: String(firstValue(row, ["sellerMemberId", "sellerBroker", "sellerBrokerId"]) ?? ""),
    contractQuantity: quantity,
    contractRate: rate,
    contractAmount: finiteNumber(firstValue(row, ["contractAmount", "amount", "tradeAmount"])) || quantity * rate,
    tradeTime: firstValue(row, ["tradeTime", "contractTime", "time"])
      ? String(firstValue(row, ["tradeTime", "contractTime", "time"]))
      : null,
  }
}

/**
 * Per-security floorsheet.
 *
 * NEPSE's dedicated endpoint (/api/nots/security/floorsheet/{id}) is hard
 * 403-blocked at their nginx WAF for non-browser traffic — verified
 * empirically: every method/header/body-id/query variant returns a raw nginx
 * 403 while sibling salted POSTs (today-price, market-wide floorsheet)
 * succeed. The market-wide floorsheet endpoint, however, accepts an
 * undocumented `stockId` query param that filters server-side to a single
 * security (totalElements drops from ~20k to the security's trade count), so
 * we source per-security rows from there instead.
 */
export function fetchFloorsheet(securityId: number): Promise<FloorsheetData> {
  return cached(`floorsheet:${securityId}`, TTL.securityDetail, async () => {
    const rows: FloorsheetRow[] = []
    let totalTrades = 0

    // 177 trades was a busy bank today; 4 pages x 500 covers even hot IPOs.
    for (let page = 0; page < 4; page++) {
      const raw = await rawPost<RawFloorsheetPayload>(
        `/api/nots/nepse-data/floorsheet?page=${page}&size=500&sort=contractId,desc&stockId=${securityId}`,
        "floorsheet",
      )
      if (!raw) break

      if (Array.isArray(raw)) {
        rows.push(...raw.map(normalizeFloorsheetRow))
        totalTrades = rows.length
        break
      }

      const sheet = raw.floorsheets
      // Defensive: if NEPSE ever ignores the stockId filter, drop foreign rows
      // instead of showing the whole market's trades under one company.
      const content = (sheet?.content ?? raw.content ?? []).filter((row) => {
        const rowStockId = finiteNumber(row.stockId)
        return rowStockId === 0 || rowStockId === securityId
      })
      rows.push(...content.map(normalizeFloorsheetRow))
      totalTrades = finiteNumber(sheet?.totalElements) || rows.length
      if (!sheet || sheet.last !== false || content.length === 0) break
    }

    // Top-level totalQty/totalAmount on this endpoint are market-wide even
    // with the stockId filter, so compute per-security totals from the rows.
    return {
      rows,
      totalQty: rows.reduce((sum, row) => sum + row.contractQuantity, 0),
      totalAmount: rows.reduce((sum, row) => sum + row.contractAmount, 0),
      totalTrades: totalTrades || rows.length,
    }
  })
}

/**
 * Intraday [epochSeconds, price] points; [] outside trading hours.
 * NEPSE returns rows shaped { contractRate, contractQuantity, time } (and
 * historically plain [t, v] tuples), so normalize both into GraphPoint tuples.
 */
type RawSecurityGraphRow = { contractRate?: number | null; time?: number | null } | [number, number]

export function fetchSecurityGraph(securityId: number): Promise<GraphPoint[]> {
  return cached(`security-graph:${securityId}`, TTL.graph, async () => {
    const raw = await rawPost<RawSecurityGraphRow[]>(`/api/nots/market/graphdata/daily/${securityId}`)
    if (!Array.isArray(raw)) return []
    const byTime = new Map<number, number>()
    for (const row of raw) {
      if (Array.isArray(row)) {
        if (typeof row[0] === "number" && typeof row[1] === "number") byTime.set(row[0], row[1])
      } else if (typeof row?.time === "number" && typeof row?.contractRate === "number") {
        byTime.set(row.time, row.contractRate)
      }
    }
    return Array.from(byTime.entries()).sort((a, b) => a[0] - b[0])
  })
}

// ---------------------------------------------------------------------------
// Corporate disclosures (company news) from nepalstock.com.np
// ---------------------------------------------------------------------------

export type Disclosure = {
  id: number
  symbol: string | null
  companyName: string | null
  headline: string
  remarks: string | null
  publishedDate: string | null
  attachmentUrl: string | null
}

type RawDisclosure = {
  id?: number
  newsHeadline?: string
  remarks?: string
  addedDate?: string
  eventDate?: string
  symbol?: string
  companyName?: string
  fileName?: string
  filePath?: string
  attachment?: string
  security?: { symbol?: string; securityName?: string }
}

type RawDisclosurePayload = { companyNews?: RawDisclosure[] } | RawDisclosure[]

/** Latest corporate disclosures / company announcements. */
export function fetchDisclosures(): Promise<Disclosure[]> {
  return cached("disclosures", TTL.summary, async () => {
    const raw = await rawGet<RawDisclosurePayload>("/api/nots/news/companies/disclosure")
    const list = Array.isArray(raw) ? raw : (raw.companyNews ?? [])
    return list.map((n) => {
      const attachment = n.filePath ?? n.attachment ?? n.fileName ?? null
      return {
        id: Number(n.id ?? 0),
        symbol: n.symbol ?? n.security?.symbol ?? null,
        companyName: n.companyName ?? n.security?.securityName ?? null,
        headline: n.newsHeadline ?? "",
        remarks: n.remarks ?? null,
        publishedDate: n.addedDate ?? n.eventDate ?? null,
        attachmentUrl: attachment ? (attachment.startsWith("http") ? attachment : `${NEPSE_BASE}${attachment.startsWith("/") ? "" : "/"}${attachment}`) : null,
      } satisfies Disclosure
    })
  })
}

/** All sector sub-indexes (Banking, Hydro Power, …) with live change values. */
export function fetchSubIndexes(): Promise<SubIndex[]> {
  return cachedLive("sub-indexes", () => rawGet<SubIndex[]>("/api/nots/"), () => null)
}

/**
 * Intraday index graph. NEPSE serves this as a POST with a *salted* body id —
 * the plain GET/POST both return 401 + []. Returns [] outside trading hours.
 * indexId 58 = NEPSE, 57 = Sensitive.
 */
export function fetchIndexGraph(indexId = 58): Promise<GraphPoint[]> {
  return cached(`index-graph:${indexId}`, TTL.graph, async () => {
    const raw = await rawPost<GraphPoint[]>(`/api/nots/graph/index/${indexId}`, "graph")
    if (!raw || !Array.isArray(raw)) return []
    // NEPSE repeats the opening tick dozens of times — keep one point per timestamp.
    const byTime = new Map<number, number>()
    for (const [t, v] of raw) byTime.set(t, v)
    return Array.from(byTime.entries()).sort((a, b) => a[0] - b[0])
  })
}

/**
 * Intraday volume series derived from the market summary.
 *
 * NEPSE's index-graph endpoint publishes only [time, indexValue] pairs — there
 * is no official per-minute volume feed. The market summary, however, carries
 * a CUMULATIVE "Total Traded Shares" figure that advances once a minute, so we
 * sample it here and serve the per-minute deltas as volume bars.
 *
 * The series lives in process memory: it starts accumulating when the server
 * first sees the summary and resets on the next Nepal trading day (or if the
 * cumulative counter goes backwards, i.e. a new session started). After a
 * server restart mid-session the bars simply resume from that point.
 */
let volumeSamples: { t: number; cum: number }[] = []
let volumeDay = ""

function nepalDateKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kathmandu" })
}

export async function fetchIntradayVolume(): Promise<GraphPoint[]> {
  const summary = await fetchMarketSummary().catch(() => null as MarketSummaryItem[] | null)
  const cum = summary?.find((s) => s.detail.startsWith("Total Traded Shares"))?.value

  const day = nepalDateKey()
  if (day !== volumeDay) {
    volumeSamples = []
    volumeDay = day
  }

  if (typeof cum === "number" && cum > 0) {
    // Bucket samples to the minute so bars align with graph tick timestamps.
    const t = Math.floor(Date.now() / 1000 / 60) * 60
    const last = volumeSamples[volumeSamples.length - 1]
    if (!last) {
      volumeSamples.push({ t, cum })
    } else if (cum < last.cum) {
      // Counter went backwards — a new session started; restart the series.
      volumeSamples = [{ t, cum }]
    } else if (t > last.t && cum > last.cum) {
      volumeSamples.push({ t, cum })
    } else if (t === last.t && cum > last.cum) {
      last.cum = cum
    }
  }

  // First sample has no previous cumulative reading, so it renders no bar (0).
  return volumeSamples.map((s, i) => [s.t, i === 0 ? 0 : s.cum - volumeSamples[i - 1].cum] as GraphPoint)
}

export function fetchMarketStatus(): Promise<MarketStatus> {
  // Deliberately NOT the library's getMarketStatus(): that goes through its
  // internal axios client whose cached token goes stale after ~a minute and
  // then 401s forever. Our rawGet mints and refreshes tokens itself.
  return cached("market-status", TTL.marketStatus, () => rawGet<MarketStatus>("/api/nots/nepse-data/market-open"))
}

export function fetchSecurities(): Promise<SecurityBrief[]> {
  return cached("securities", TTL.securities, () => getSecurities())
}

export function fetchSecurityDetail(symbol: string): Promise<SecurityDetail> {
  const normalized = symbol.trim().toUpperCase()
  return cached(`security:${normalized}`, TTL.securityDetail, () => getSecurityDetail(normalized))
}

export function fetchNepseIndex(): Promise<IndexDetail[]> {
  return cachedLive(
    "nepse-index",
    () => rawGet<IndexDetail[]>("/api/nots/nepse-index"),
    (rows) => rows.find((r) => r.generatedTime)?.generatedTime ?? null,
  )
}

// ---------------------------------------------------------------------------
// Error helper for route handlers
// ---------------------------------------------------------------------------

export function toErrorResponse(err: unknown): { message: string; code: string; status: number } {
  const code =
    typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN"

  const message = err instanceof Error ? err.message : "Unexpected error while contacting NEPSE"

  // NEPSE upstream failures are a 502 from our proxy's perspective.
  const status = code === "NOT_INITIALIZED" ? 503 : 502

  return { message, code, status }
}
