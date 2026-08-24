"use client"

import useSWR from "swr"
import {
  nepseFetcher,
  formatNepali,
  formatInt,
  formatRs,
  LIVE_SWR_OPTS,
  type TopMover,
  type TopTradeItem,
  type TopTurnoverItem,
  type TopTransactionItem,
} from "@/lib/nepse-client"
import type { SelectedSector } from "./index-panel"

type MoverRow = { key: string; symbol: string; primary: string; secondary: string; tone: string }

const SWR_OPTS = LIVE_SWR_OPTS

function topUrl(type: string, selected: SelectedSector): string {
  return `/api/nepse/top?type=${type}${selected ? `&indexId=${selected.id}` : ""}`
}

/** One mover column: fixed header, scrollable ranked body. */
function MoverPanel({
  title,
  unit,
  rows,
  loading,
  emptyLabel,
}: {
  title: string
  unit: string
  rows: MoverRow[]
  loading: boolean
  emptyLabel: string
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label={title}>
      <div className="flex shrink-0 items-baseline justify-between gap-1 border-b border-border bg-terminal-head px-3 py-2">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-terminal-head-foreground">
          {title}
        </h3>
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{unit}</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-px bg-border p-px" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse bg-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="terminal-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
          {rows.map((r, i) => (
            <li
              key={r.key}
              className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-xs last:border-b-0 even:bg-row-alt"
            >
              <span className="w-4 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-card-foreground" title={r.symbol}>
                {r.symbol}
              </span>
              <span className="flex shrink-0 flex-col items-end leading-tight">
                <span className={`font-mono text-[11px] font-bold tabular-nums ${r.tone}`}>{r.primary}</span>
                <span className="font-mono text-[9px] tabular-nums text-muted-foreground">{r.secondary}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * Full-width Top Movers board: Gainers, Losers, Turnover, Volume and Trades
 * each get their own always-visible column instead of hiding behind tabs.
 */
export function TopMovers({ selected }: { selected: SelectedSector }) {
  const { data: gainers } = useSWR<TopMover[]>(topUrl("gainer", selected), nepseFetcher, SWR_OPTS)
  const { data: losers } = useSWR<TopMover[]>(topUrl("loser", selected), nepseFetcher, SWR_OPTS)
  const { data: turnover } = useSWR<TopTurnoverItem[]>(topUrl("turnover", selected), nepseFetcher, SWR_OPTS)
  const { data: trade } = useSWR<TopTradeItem[]>(topUrl("trade", selected), nepseFetcher, SWR_OPTS)
  const { data: transactions } = useSWR<TopTransactionItem[]>(topUrl("transaction", selected), nepseFetcher, SWR_OPTS)

  const empty = selected ? `No ${selected.name} scrips today.` : "No data available."

  const gainerRows: MoverRow[] = (gainers ?? []).map((g) => ({
    key: g.symbol,
    symbol: g.symbol,
    primary: `+${g.percentageChange.toFixed(2)}%`,
    secondary: formatRs(g.ltp),
    tone: "text-gain",
  }))

  const loserRows: MoverRow[] = (losers ?? []).map((l) => ({
    key: l.symbol,
    symbol: l.symbol,
    primary: `${l.percentageChange.toFixed(2)}%`,
    secondary: formatRs(l.ltp),
    tone: "text-loss",
  }))

  const turnoverRows: MoverRow[] = (turnover ?? []).map((t) => ({
    key: t.symbol,
    symbol: t.symbol,
    primary: formatNepali(t.turnover),
    secondary: formatRs(t.closingPrice),
    tone: "text-primary",
  }))

  const volumeRows: MoverRow[] = (trade ?? []).map((t) => ({
    key: t.symbol,
    symbol: t.symbol,
    primary: formatNepali(t.shareTraded),
    secondary: formatRs(t.closingPrice),
    tone: "text-card-foreground",
  }))

  const tradeRows: MoverRow[] = (transactions ?? []).map((t) => ({
    key: t.symbol,
    symbol: t.symbol,
    primary: formatInt(t.totalTrades),
    secondary: formatRs(t.lastTradedPrice),
    tone: "text-card-foreground",
  }))

  return (
    <section aria-label="Top movers" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-primary">Top Movers</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {selected ? `Filtered · ${selected.name}` : "Market wide"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="flex h-64 flex-col">
          <MoverPanel title="Gainers" unit="% Chg" rows={gainerRows} loading={!gainers} emptyLabel={empty} />
        </div>
        <div className="flex h-64 flex-col">
          <MoverPanel title="Losers" unit="% Chg" rows={loserRows} loading={!losers} emptyLabel={empty} />
        </div>
        <div className="flex h-64 flex-col">
          <MoverPanel title="Turnover" unit="Rs" rows={turnoverRows} loading={!turnover} emptyLabel={empty} />
        </div>
        <div className="flex h-64 flex-col">
          <MoverPanel title="Volume" unit="Shares" rows={volumeRows} loading={!trade} emptyLabel={empty} />
        </div>
        <div className="flex h-64 flex-col">
          <MoverPanel title="Trades" unit="Count" rows={tradeRows} loading={!transactions} emptyLabel={empty} />
        </div>
      </div>
    </section>
  )
}
