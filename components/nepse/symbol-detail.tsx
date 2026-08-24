"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  nepseFetcher,
  formatRs,
  formatInt,
  LIVE_SWR_OPTS,
  type CompanyDetail,
  type MarketDepth,
  type FloorsheetData,
  type GraphPoint,
  type Fundamentals,
} from "@/lib/nepse-client"
import { BrokerHoldingSection } from "@/components/nepse/broker-holding"

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function formatTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kathmandu",
  })
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

/** Card shell with a slim brand-colored header bar. */
function SectionCard({
  title,
  meta,
  children,
  className = "",
}: {
  title: string
  meta?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm ${className}`}
      aria-label={title}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border bg-terminal-head px-3 py-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-terminal-head-foreground">{title}</h3>
        {meta ? <span className="text-[10px] font-medium text-terminal-head-foreground/80">{meta}</span> : null}
      </header>
      {children}
    </section>
  )
}

function DetailRow({
  label,
  highlight = false,
  children,
}: {
  label: string
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 border-t border-border px-3 py-1.5 first:border-t-0 ${
        highlight ? "bg-accent/50" : "odd:bg-row-alt/60"
      }`}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-xs font-semibold tabular-nums text-card-foreground">{children}</dd>
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-3">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
      <p className="text-xs text-muted-foreground text-pretty">{children}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Intraday price chart
// ---------------------------------------------------------------------------

function PriceChart({
  securityId,
  symbol,
  previousClose,
}: {
  securityId: number
  symbol: string
  previousClose: number | null
}) {
  const { data: graph } = useSWR<GraphPoint[]>(`/api/nepse/security-graph/${securityId}`, nepseFetcher, {
    refreshInterval: 60_000,
  })
  const points = (graph ?? []).map(([t, v]) => ({ t, v }))
  const hasGraph = points.length > 1

  const last = hasGraph ? points[points.length - 1].v : null
  const up = last !== null && previousClose !== null ? last >= previousClose : true
  const stroke = up ? "var(--color-gain)" : "var(--color-loss)"

  return (
    <SectionCard title="Intraday Chart" meta={hasGraph ? `${points.length} ticks · NPT` : undefined}>
      <div className="h-48 w-full sm:h-56">
        {hasGraph ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="securityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={formatTime}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                domain={["dataMin - 1", "dataMax + 1"]}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={(v: number) => v.toFixed(0)}
              />
              {previousClose !== null ? (
                <ReferenceLine
                  y={previousClose}
                  stroke="var(--color-muted-foreground)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                  label={{
                    value: "Prev close",
                    position: "insideTopRight",
                    fontSize: 9,
                    fill: "var(--color-muted-foreground)",
                  }}
                />
              ) : null}
              <Tooltip
                formatter={(value) => [formatRs(Number(value)), symbol]}
                labelFormatter={(t) => `${formatTime(Number(t))} NPT`}
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={stroke}
                strokeWidth={1.75}
                fill="url(#securityFill)"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
            <p className="text-sm font-medium text-muted-foreground">Live chart unavailable</p>
            <p className="text-xs text-muted-foreground text-pretty">
              NEPSE publishes intraday price data only while the market is open (11:00–15:00 NPT, Mon–Fri).
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Market depth (order book)
// ---------------------------------------------------------------------------

function DepthTable({
  title,
  levels,
  total,
  side,
}: {
  title: string
  levels: Array<{ orderBookOrderPrice: number; quantity: number; orderCount: number }>
  total: number
  side: "buy" | "sell"
}) {
  const shown = levels.slice(0, 10)
  const maxQty = Math.max(1, ...shown.map((l) => l.quantity))
  const tone = side === "buy" ? "text-gain" : "text-loss"
  const bar = side === "buy" ? "bg-gain-surface" : "bg-loss-surface"
  const headTone =
    side === "buy"
      ? "bg-gain-surface text-gain-surface-foreground"
      : "bg-loss-surface text-loss-surface-foreground"

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse text-xs">
        <caption className={`px-2.5 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide ${headTone}`}>
          {title}
        </caption>
        <thead>
          <tr className="border-t border-border bg-secondary text-muted-foreground">
            <th className="px-2.5 py-1 text-left font-medium">Orders</th>
            <th className="px-2.5 py-1 text-right font-medium">Qty</th>
            <th className="px-2.5 py-1 text-right font-medium">Price</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {shown.map((l, i) => (
            <tr key={i} className="relative border-t border-border bg-card">
              <td className="relative px-2.5 py-1">
                {/* depth bar */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 ${bar} opacity-60`}
                  style={{ width: `${Math.round((l.quantity / maxQty) * 100)}%` }}
                />
                <span className="relative">{l.orderCount}</span>
              </td>
              <td className="px-2.5 py-1 text-right">{formatInt(l.quantity)}</td>
              <td className={`px-2.5 py-1 text-right font-semibold ${tone}`}>{formatRs(l.orderBookOrderPrice)}</td>
            </tr>
          ))}
          <tr className="border-t border-border bg-secondary font-semibold">
            <td className="px-2.5 py-1" colSpan={2}>
              Total Qty
            </td>
            <td className="px-2.5 py-1 text-right">{formatInt(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function DepthSection({ securityId, company }: { securityId: number; company: CompanyDetail | undefined }) {
  const { data: depth } = useSWR<MarketDepth>(`/api/nepse/depth/${securityId}`, nepseFetcher, LIVE_SWR_OPTS)

  const spread =
    depth && depth.buy.length > 0 && depth.sell.length > 0
      ? depth.sell[0].orderBookOrderPrice - depth.buy[0].orderBookOrderPrice
      : null

  return (
    <SectionCard title="Market Depth" meta={spread !== null ? `Spread ${formatRs(spread)}` : undefined}>
      <div className="flex flex-col gap-3 p-3">
        {/* OHLC summary strip */}
        {company ? (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {(
              [
                ["LTP", company.lastTradedPrice, true],
                ["Pr. Close", company.previousClose, false],
                ["Open", company.openPrice, false],
                ["High", company.highPrice, false],
                ["Low", company.lowPrice, false],
                ["Close", company.closePrice, false],
              ] as const
            ).map(([label, value, emphasize]) => (
              <div
                key={label}
                className={`flex flex-col gap-0.5 rounded-md border px-2 py-1.5 ${
                  emphasize ? "border-primary/40 bg-accent" : "border-border bg-row-alt/60"
                }`}
              >
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider ${
                    emphasize ? "text-accent-foreground" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
                <span
                  className={`font-mono text-xs font-bold tabular-nums ${
                    emphasize ? "text-accent-foreground" : "text-foreground"
                  }`}
                >
                  {formatRs(value)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {depth && (depth.buy.length > 0 || depth.sell.length > 0) ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DepthTable title="Buy Orders" levels={depth.buy} total={depth.totalBuyQty} side="buy" />
            <DepthTable title="Sell Orders" levels={depth.sell} total={depth.totalSellQty} side="sell" />
          </div>
        ) : (
          <EmptyNote>
            Order book is empty — NEPSE clears market depth outside trading hours (11:00–15:00 NPT, Mon–Fri).
          </EmptyNote>
        )}
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Floor sheet
// ---------------------------------------------------------------------------

const FLOORSHEET_DEFAULT_PER_PAGE = 20

function FloorsheetSection({ securityId }: { securityId: number }) {
  const { data: sheet } = useSWR<FloorsheetData>(`/api/nepse/floorsheet/${securityId}`, nepseFetcher, LIVE_SWR_OPTS)

  const [perPageDraft, setPerPageDraft] = useState(String(FLOORSHEET_DEFAULT_PER_PAGE))
  const [perPage, setPerPage] = useState(FLOORSHEET_DEFAULT_PER_PAGE)
  const [page, setPage] = useState(1)

  const rows = sheet?.rows ?? []
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage))
  const safePage = Math.min(page, totalPages)
  const startIndex = (safePage - 1) * perPage
  const shownRows = rows.slice(startIndex, startIndex + perPage)

  const applyFilter = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = Number.parseInt(perPageDraft, 10)
    const next = Number.isInteger(parsed) ? Math.min(500, Math.max(1, parsed)) : FLOORSHEET_DEFAULT_PER_PAGE
    setPerPageDraft(String(next))
    setPerPage(next)
    setPage(1)
  }

  const resetFilter = () => {
    setPerPageDraft(String(FLOORSHEET_DEFAULT_PER_PAGE))
    setPerPage(FLOORSHEET_DEFAULT_PER_PAGE)
    setPage(1)
  }

  return (
    <SectionCard
      title="Floor Sheet"
      meta={sheet && sheet.rows.length > 0 ? `${formatInt(sheet.totalTrades)} trades today` : undefined}
    >
      {sheet && sheet.rows.length > 0 ? (
        <>
          {/* Items-per-page filter bar */}
          <form
            onSubmit={applyFilter}
            className="flex flex-wrap items-center gap-2 border-b border-border bg-row-alt/40 px-3 py-2"
          >
            <label htmlFor={`floorsheet-per-page-${securityId}`} className="text-xs text-muted-foreground">
              Items Per Page
            </label>
            <input
              id={`floorsheet-per-page-${securityId}`}
              type="number"
              min={1}
              max={500}
              inputMode="numeric"
              value={perPageDraft}
              onChange={(e) => setPerPageDraft(e.target.value)}
              className="h-7 w-20 rounded-md border border-border bg-card px-2 font-mono text-xs tabular-nums text-card-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              className="h-7 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Filter
            </button>
            <button
              type="button"
              onClick={resetFilter}
              className="h-7 px-1 text-xs font-medium text-loss transition-colors hover:underline"
            >
              Reset
            </button>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatInt(startIndex + 1)}–{formatInt(startIndex + shownRows.length)} of {formatInt(rows.length)}
            </span>
          </form>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="bg-secondary text-muted-foreground">
                <th className="px-2.5 py-1.5 text-left font-semibold">SN</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">Contract No.</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">Buyer</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">Seller</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">Quantity</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">Rate (Rs)</th>
                <th className="px-2.5 py-1.5 text-right font-semibold">Amount (Rs)</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {shownRows.map((r, i) => (
                <tr key={r.contractId} className="border-t border-border odd:bg-row-alt/60 hover:bg-accent/40">
                  <td className="px-2.5 py-1">{startIndex + i + 1}</td>
                  <td className="px-2.5 py-1">{r.contractId}</td>
                  <td className="px-2.5 py-1 text-right" title={r.buyerMemberId ? undefined : "Hidden by NEPSE during market hours"}>
                    {r.buyerMemberId || "Hidden"}
                  </td>
                  <td className="px-2.5 py-1 text-right" title={r.sellerMemberId ? undefined : "Hidden by NEPSE during market hours"}>
                    {r.sellerMemberId || "Hidden"}
                  </td>
                  <td className="px-2.5 py-1 text-right">{formatInt(r.contractQuantity)}</td>
                  <td className="px-2.5 py-1 text-right">{formatRs(r.contractRate)}</td>
                  <td className="px-2.5 py-1 text-right">{formatRs(r.contractAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary font-mono text-xs font-semibold tabular-nums">
                <td className="px-2.5 py-1.5" colSpan={4}>
                  Totals ({formatInt(sheet.totalTrades)} trades)
                </td>
                <td className="px-2.5 py-1.5 text-right">{formatInt(sheet.totalQty)}</td>
                <td className="px-2.5 py-1.5" />
                <td className="px-2.5 py-1.5 text-right">{formatRs(sheet.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
          {/* Pager */}
          {totalPages > 1 ? (
            <nav
              className="flex items-center justify-between gap-2 border-t border-border bg-row-alt/40 px-3 py-2"
              aria-label="Floor sheet pages"
            >
              <button
                type="button"
                onClick={() => setPage(Math.max(1, safePage - 1))}
                disabled={safePage <= 1}
                className="h-7 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-card-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                Page {formatInt(safePage)} of {formatInt(totalPages)}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                disabled={safePage >= totalPages}
                className="h-7 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-card-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
            </nav>
          ) : null}
        </>
      ) : (
        <EmptyNote>No floor sheet entries are available for this company yet.</EmptyNote>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Key fundamentals (quarterly financials via chukul.com)
// ---------------------------------------------------------------------------

function FundamentalsSection({ symbol }: { symbol: string }) {
  const { data, error, isLoading } = useSWR<Fundamentals | null>(
    `/api/nepse/fundamentals/${encodeURIComponent(symbol)}`,
    nepseFetcher,
    { refreshInterval: 10 * 60_000, revalidateOnFocus: false },
  )

  const fmt = (v: number | null, suffix = ""): string =>
    v === null ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`

  const tiles: Array<[string, string]> = data
    ? ([
        ["EPS (Reported)", fmt(data.epsReported)],
        ["EPS (Annualized)", fmt(data.epsAnnualized)],
        ["Dis EPS", fmt(data.disEps)],
        ["ROA", fmt(data.roa, "%")],
        ["ROE", fmt(data.roe, "%")],
        ["Net Worth", fmt(data.netWorth)],
        ["NPL", fmt(data.npl, "%")],
        ["P/E Ratio", fmt(data.peRatio)],
        ["P/B Ratio", fmt(data.pbRatio)],
        ["Growth Rate", fmt(data.growthRate, "%")],
      ].filter(([, v]) => v !== "—") as Array<[string, string]>)
    : []

  return (
    <SectionCard
      title="Key Fundamentals"
      meta={data?.quarter && data?.fiscalYear ? `${data.quarter} · ${data.fiscalYear}` : undefined}
    >
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : error ? (
        <EmptyNote>Could not load fundamentals right now — it will retry automatically.</EmptyNote>
      ) : !data || tiles.length === 0 ? (
        <EmptyNote>No quarterly fundamentals published for {symbol} yet.</EmptyNote>
      ) : (
        <dl className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-md border border-border bg-row-alt/60 px-2.5 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
              <dd className="font-mono text-sm font-bold tabular-nums text-card-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SymbolDetail({
  securityId,
  symbol,
  onClose,
}: {
  securityId: number
  symbol: string
  onClose: () => void
}) {
  const {
    data: company,
    error,
    isLoading,
  } = useSWR<CompanyDetail>(`/api/nepse/company/${securityId}`, nepseFetcher, LIVE_SWR_OPTS)

  const panelRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [securityId])

  const hasClose = Boolean(company?.lastTradedPrice && company?.previousClose)
  const change = hasClose && company ? (company.lastTradedPrice ?? 0) - (company.previousClose ?? 0) : 0
  const perChange = hasClose && company?.previousClose ? (change / company.previousClose) * 100 : 0
  const up = change > 0
  const flat = change === 0
  const tone = flat ? "text-muted-foreground" : up ? "text-gain" : "text-loss"
  const chip = flat
    ? "bg-secondary text-secondary-foreground"
    : up
      ? "bg-gain-surface text-gain-surface-foreground"
      : "bg-loss-surface text-loss-surface-foreground"

  return (
    <aside
      ref={panelRef}
      className="flex scroll-mt-4 flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      aria-label={`${symbol} company details`}
    >
      {/* Header band */}
      <div className="flex flex-col gap-3 border-b border-border bg-accent/40 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-primary px-2 py-0.5 font-mono text-sm font-bold text-primary-foreground">
                {symbol}
              </span>
              <h2 className="text-lg font-semibold text-card-foreground text-balance">
                {company?.securityName ?? symbol}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {company?.sector ? (
                <>
                  Sector: <span className="font-medium text-foreground">{company.sector}</span>
                </>
              ) : null}
              {company ? (
                <>
                  {company.sector ? " · " : null}
                  Permitted to Trade:{" "}
                  <span className="font-medium text-foreground">{company.permittedToTrade ? "Yes" : "No"}</span>
                  {" · "}Status: <span className="font-medium text-foreground">{company.activeStatus}</span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            Close
          </button>
        </div>

        {/* Price headline */}
        {!isLoading && company ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums text-card-foreground">
              {formatRs(company.lastTradedPrice)}
            </span>
            {hasClose ? (
              <span className={`rounded-md px-2 py-1 font-mono text-sm font-semibold tabular-nums ${chip}`}>
                {up ? "▲ +" : flat ? "" : "▼ "}
                {formatRs(change)} ({up ? "+" : ""}
                {perChange.toFixed(2)}%)
              </span>
            ) : null}
            {company.asOf ? (
              <span className="text-xs text-muted-foreground">As of {formatDate(company.asOf)}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 p-4 pt-1">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <div className="h-8 w-36 animate-pulse rounded bg-muted" />
            <div className="h-44 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : error || !company ? (
          <p className="text-sm text-muted-foreground">
            Could not load {symbol} right now. NEPSE may be temporarily unavailable — it will retry automatically.
          </p>
        ) : (
          <>
            {/* Live chart */}
            <PriceChart securityId={securityId} symbol={symbol} previousClose={company.previousClose} />

            {/* Market depth */}
            <DepthSection securityId={securityId} company={company} />

            {/* Floor sheet */}
            <FloorsheetSection securityId={securityId} />

            {/* Broker holding (weekly/monthly accumulation vs distribution) */}
            <BrokerHoldingSection symbol={symbol} />

            {/* Company detail + ownership */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard title="Company Details">
                <dl>
                  <DetailRow label="Instrument Type">{company.instrumentType ?? "—"}</DetailRow>
                  <DetailRow label="Listing Date">{formatDate(company.listingDate)}</DetailRow>
                  <DetailRow label="Last Traded Price" highlight>
                    <span className={tone}>
                      {formatRs(company.lastTradedPrice)}
                      {hasClose ? ` (${up ? "+" : ""}${perChange.toFixed(2)}%)` : ""}
                    </span>
                  </DetailRow>
                  <DetailRow label="Total Traded Quantity">{formatInt(company.totalTradeQuantity)}</DetailRow>
                  <DetailRow label="Total Trades">{formatInt(company.totalTrades)}</DetailRow>
                  <DetailRow label="Previous Day Close">{formatRs(company.previousClose)}</DetailRow>
                  <DetailRow label="High / Low">
                    {formatRs(company.highPrice)} / {formatRs(company.lowPrice)}
                  </DetailRow>
                  <DetailRow label="52 Week High / Low">
                    {formatRs(company.fiftyTwoWeekHigh)} / {formatRs(company.fiftyTwoWeekLow)}
                  </DetailRow>
                  <DetailRow label="Open Price">{formatRs(company.openPrice)}</DetailRow>
                  <DetailRow label="Close Price">{formatRs(company.closePrice)}</DetailRow>
                </dl>
              </SectionCard>

              <SectionCard title="Shares & Ownership">
                <dl>
                  <DetailRow label="Total Listed Shares">{formatInt(company.stockListedShares)}</DetailRow>
                  <DetailRow label="Total Paid up Value">{formatRs(company.paidUpCapital)}</DetailRow>
                  <DetailRow label="Market Capitalization" highlight>
                    {formatRs(company.marketCapitalization)}
                  </DetailRow>
                  <DetailRow label="Promoter Shares">
                    {formatInt(company.promoterShares)}
                    {company.promoterPercentage !== null ? ` (${company.promoterPercentage.toFixed(2)}%)` : ""}
                  </DetailRow>
                  <DetailRow label="Public Shares">
                    {formatInt(company.publicShares)}
                    {company.publicPercentage !== null ? ` (${company.publicPercentage.toFixed(2)}%)` : ""}
                  </DetailRow>
                  <DetailRow label="Ownership Updated">{formatDate(company.ownershipUpdatedDate)}</DetailRow>
                  {company.website ? (
                    <DetailRow label="Website">
                      <a
                        href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {company.website}
                      </a>
                    </DetailRow>
                  ) : null}
                </dl>

                {/* Promoter vs public split bar */}
                {company.promoterPercentage !== null && company.publicPercentage !== null ? (
                  <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5">
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="presentation">
                      <div className="bg-primary" style={{ width: `${company.promoterPercentage}%` }} />
                      <div className="bg-gain" style={{ width: `${company.publicPercentage}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-primary" />
                        Promoter {company.promoterPercentage.toFixed(2)}%
                      </span>
                      <span className="flex items-center gap-1">
                        <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-gain" />
                        Public {company.publicPercentage.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ) : null}
              </SectionCard>
            </div>

            {/* Key fundamentals */}
            <FundamentalsSection symbol={symbol} />
          </>
        )}
      </div>
    </aside>
  )
}
