// ---------------------------------------------------------------------------
// Company fundamentals from chukul.com's public API (stock-profile page data).
//   1. GET /api/stock/?search={symbol}   → resolve symbol to chukul stock id
//   2. GET /api/stock/{id}/report/       → quarterly fundamental reports
// ---------------------------------------------------------------------------

const CHUKUL_BASE = "https://chukul.com"

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://chukul.com/stock-profile",
}

export type Fundamentals = {
  symbol: string
  quarter: string // e.g. "Q4"
  fiscalYear: string // e.g. "082/083"
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

type ChukulStock = { id: number; symbol: string }

type ChukulReport = {
  quarter?: string
  fiscal_year?: string
  eps?: number
  eps_a?: number
  dps?: number
  roa?: number
  roe?: number
  net_worth?: number
  npl?: number
  pe_ratio?: number
  growth_rate?: number
  close?: number
}

async function chukulGet<T>(path: string): Promise<T> {
  const res = await fetch(`${CHUKUL_BASE}${path}`, {
    headers: HEADERS,
    next: { revalidate: 600 },
  })
  if (!res.ok) throw new Error(`chukul.com responded ${res.status} for ${path}`)
  return (await res.json()) as T
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/** Latest-quarter key fundamentals for a NEPSE symbol, or null when chukul has no report. */
export async function fetchFundamentals(symbol: string): Promise<Fundamentals | null> {
  const clean = symbol.trim().toUpperCase()

  const matches = await chukulGet<ChukulStock[]>(`/api/stock/?search=${encodeURIComponent(clean)}`)
  const stock = matches.find((s) => s.symbol?.toUpperCase() === clean)
  if (!stock) return null

  const reports = await chukulGet<ChukulReport[]>(`/api/stock/${stock.id}/report/`)
  const latest = reports?.[0]
  if (!latest) return null

  const netWorth = num(latest.net_worth)
  const close = num(latest.close)
  const pb = netWorth && close ? close / netWorth : null

  return {
    symbol: clean,
    quarter: (latest.quarter ?? "").toUpperCase(),
    fiscalYear: latest.fiscal_year ?? "",
    epsReported: num(latest.eps),
    epsAnnualized: num(latest.eps_a),
    disEps: num(latest.dps),
    roa: num(latest.roa),
    roe: num(latest.roe),
    netWorth,
    npl: num(latest.npl),
    peRatio: num(latest.pe_ratio),
    pbRatio: pb !== null ? Math.round(pb * 100) / 100 : null,
    growthRate: num(latest.growth_rate),
  }
}
