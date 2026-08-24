"use client"

import useSWR from "swr"
import {
  nepseFetcher,
  formatRs,
  formatNepali,
  formatInt,
  isNepseIndex,
  LIVE_SWR_OPTS,
  type IndexDetail,
  type MarketStatus,
  type MarketSummaryItem,
} from "@/lib/nepse-client"

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-input pl-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

/**
 * Live index strip rendered directly beneath the brand banner.
 * Big NEPSE quote on the left, day statistics on the right.
 */
export function MarketHeader() {
  const {
    data: indexes,
    error: indexError,
    isLoading: isIndexLoading,
  } = useSWR<IndexDetail[]>("/api/nepse/index", nepseFetcher, LIVE_SWR_OPTS)
  // Open/close status is not a price, so it stays on a slow poll.
  const { data: status } = useSWR<MarketStatus>("/api/nepse/status", nepseFetcher, { refreshInterval: 60_000 })
  const { data: summary } = useSWR<MarketSummaryItem[]>("/api/nepse/summary", nepseFetcher, LIVE_SWR_OPTS)

  const nepse = indexes?.find((i) => isNepseIndex(i.index))
  const turnover = summary?.find((s) => s.detail.startsWith("Total Turnover"))?.value
  const shares = summary?.find((s) => s.detail.startsWith("Total Traded Shares"))?.value
  const transactions = summary?.find((s) => s.detail.startsWith("Total Transactions"))?.value

  const up = (nepse?.change ?? 0) > 0
  const flat = (nepse?.change ?? 0) === 0
  const tone = flat ? "text-muted-foreground" : up ? "text-gain" : "text-loss"
  const chip = flat
    ? "bg-secondary text-secondary-foreground"
    : up
      ? "bg-gain-surface text-gain-surface-foreground"
      : "bg-loss-surface text-loss-surface-foreground"

  const asOf = status?.asOf
    ? new Date(status.asOf).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kathmandu",
      })
    : null

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-1 sm:px-5 lg:flex-row lg:items-end lg:justify-between">
      {/* Index quote */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-primary">NEPSE Index</h1>
          {asOf ? (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{asOf} NPT</span>
          ) : null}
        </div>
        {nepse ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`font-mono text-4xl font-bold tabular-nums sm:text-5xl ${tone}`}>
              {formatRs(nepse.currentValue)}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-sm font-bold tabular-nums ${chip}`}
            >
              {up ? "▲" : flat ? "" : "▼"} {up ? "+" : ""}
              {formatRs(nepse.change)} ({up ? "+" : ""}
              {nepse.perChange.toFixed(2)}%)
            </span>
          </div>
        ) : isIndexLoading ? (
          <span className="h-12 w-56 animate-pulse rounded-md bg-muted" aria-label="Loading NEPSE index" />
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            {indexError ? "Live index temporarily unavailable. Retrying automatically." : "NEPSE index is unavailable."}
          </p>
        )}
      </div>

      {/* Day statistics */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5 lg:gap-x-8">
        {nepse ? (
          <>
            <Stat label="High" value={formatRs(nepse.high)} />
            <Stat label="Low" value={formatRs(nepse.low)} />
          </>
        ) : null}
        {turnover !== undefined ? <Stat label="Turnover" value={`Rs ${formatNepali(turnover)}`} /> : null}
        {shares !== undefined ? <Stat label="Shares" value={formatNepali(shares)} /> : null}
        {transactions !== undefined ? <Stat label="Trades" value={formatInt(transactions)} /> : null}
      </dl>
    </div>
  )
}
