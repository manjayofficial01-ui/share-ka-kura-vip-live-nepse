/**
 * Client-side types and SWR fetcher for the /api/nepse proxy routes.
 * Mirrors the shapes returned by nepse-api-helper, serialized as JSON.
 */

export type MarketStatus = {
  isOpen: string
  asOf: string
  id: number
}

export type IndexDetail = {
  id: number
  index: string
  close: number
  high: number
  low: number
  previousClose: number
  change: number
  perChange: number
  fiftyTwoWeekHigh: number
  fiftyTwoWeekLow: number
  currentValue: number
  generatedTime: string
}

export function normalizeIndexName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

export function isNepseIndex(name: string): boolean {
  const normalized = normalizeIndexName(name)
  return normalized === "nepse" || normalized === "nepse index"
}

export function matchesIndexName(actual: string, expected: string): boolean {
  if (isNepseIndex(expected)) return isNepseIndex(actual)
  return normalizeIndexName(actual) === normalizeIndexName(expected)
}

export type SecurityBrief = {
  activeStatus: string
  id: number
  name: string
  securityName: string
  symbol: string
}

export type SecurityDetail = {
  id: number
  symbol: string
  name: string
  activeStatus: string
  listingDate: string
  closePrice: number
  businessDate: string
  fiftyTwoWeekHigh: number
  fiftyTwoWeekLow: number
  lastTradePrice: number
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

/** Full live-market row from /api/nepse/live (NEPSE's lives-market endpoint). */
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

export type TopTransactionItem = {
  symbol: string
  totalTrades: number
  lastTradedPrice: number
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

export type GraphPoint = [number, number]

/**
 * Response of /api/nepse/graph: NEPSE (58) and Sensitive (57) intraday series,
 * plus a per-minute [minuteEpoch, sharesTraded] volume series derived from the
 * market summary's cumulative traded-shares counter.
 */
export type IndexGraphs = {
  nepse: GraphPoint[]
  sensitive: GraphPoint[]
  volume?: GraphPoint[]
}

export type Disclosure = {
  id: number
  symbol: string | null
  companyName: string | null
  headline: string
  remarks: string | null
  publishedDate: string | null
  attachmentUrl: string | null
}

export type Fundamentals = {
  symbol: string
  quarter: string
  fiscalYear: string
  epsReported: number | null
  epsAnnualized: number | null
  disEps: number | null
  roa: number | null
  roe: number | null
  netWorth: number | null
  npl: number | null
  peRatio: number | null
  pbRatio: number | null
  growthRate: number | null
}

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

export type DepthLevel = { orderBookOrderPrice: number; quantity: number; orderCount: number }

export type MarketDepth = {
  buy: DepthLevel[]
  sell: DepthLevel[]
  totalBuyQty: number
  totalSellQty: number
} | null

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

export type ApiEnvelope<T> = {
  data: T
  total?: number
  error?: { message: string; code: string }
}

export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

/**
 * Floor for the client poll interval.
 *
 * SWR schedules the next poll only AFTER the previous one resolves, so the real
 * gap is interval + request latency. 500ms measures a ~1.0-1.3s gap end to end.
 *
 * Polling our own API this fast is cheap: the phase-locked cache + inflight
 * dedup in lib/nepse.ts collapse these into ~8 upstream NEPSE calls per minute
 * regardless of how many browsers are watching. Do NOT try to buy freshness by
 * shortening the server cache instead — NEPSE only publishes once a minute, so
 * that multiplies upstream calls for zero freshness gain. See lib/feed-clock.ts.
 */
export const LIVE_REFRESH_MS = 500

/**
 * Shared SWR options for every real-time feed. Import this instead of
 * hand-writing refreshInterval.
 *
 * Feeds that carry NEPSE's own timestamp should additionally phase-lock their
 * poll interval (see useLiveMarket) so they wake up at the publish boundary
 * rather than grinding at 500ms through a minute in which nothing can change.
 */
export const LIVE_SWR_OPTS = {
  refreshInterval: LIVE_REFRESH_MS,
  // Keep polling in a background tab so returning to it never shows stale prices.
  refreshWhenHidden: true,
  refreshWhenOffline: false,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  // Avoid blanking the UI between polls.
  keepPreviousData: true,
  // Dedup must never exceed the poll interval or scheduled polls get dropped.
  // 0 disables it; the server cache is what actually protects upstream.
  dedupingInterval: 0,
} as const

export async function nepseFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null

  if (!res.ok || !body || body.error) {
    throw new ApiError(
      body?.error?.message ?? `Request failed with status ${res.status}`,
      body?.error?.code ?? "UNKNOWN",
      res.status,
    )
  }

  return body.data
}

export function formatRs(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 })
}

/** Nepali-style abbreviations: 1 Ar. = 1e9, 1 Cr. = 1e7, 1 Lac. = 1e5. */
export function formatNepali(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} Ar.`
  if (abs >= 1e7) return `${(value / 1e7).toFixed(2)} Cr.`
  if (abs >= 1e5) return `${(value / 1e5).toFixed(2)} Lac.`
  return formatInt(value)
}
