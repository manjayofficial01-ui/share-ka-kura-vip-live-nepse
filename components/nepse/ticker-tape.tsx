"use client"

import { useMemo } from "react"
import { formatRs } from "@/lib/nepse-client"
import { useLiveMarket } from "@/lib/use-live-market"

const TICKER_COUNT = 30

/**
 * Scrolling ticker tape of the day's most-traded symbols.
 * Two copies of the list slide left for a seamless infinite loop;
 * hover pauses so values can be read.
 */
export function TickerTape() {
  // Shared hook so the ticker rides the same 3s poll as the rest of the board.
  const { rows: data } = useLiveMarket()

  const items = useMemo(() => {
    if (!data) return []
    return [...data].sort((a, b) => b.totalTradeValue - a.totalTradeValue).slice(0, TICKER_COUNT)
  }, [data])

  if (items.length === 0) return null

  const strip = items.map((s) => {
    const up = s.percentageChange > 0
    const flat = s.percentageChange === 0
    const tone = flat ? "text-muted-foreground" : up ? "text-gain" : "text-loss"
    return (
      <span key={s.securityId} className="inline-flex items-baseline gap-1.5 px-3">
        <span className="text-[11px] font-bold text-secondary-foreground">{s.symbol}</span>
        <span className="font-mono text-[11px] tabular-nums text-foreground">{formatRs(s.lastTradedPrice)}</span>
        <span className={`font-mono text-[10px] font-semibold tabular-nums ${tone}`}>
          {up ? "▲" : flat ? "" : "▼"}
          {up ? "+" : ""}
          {s.percentageChange.toFixed(2)}%
        </span>
      </span>
    )
  })

  return (
    <div
      className="relative overflow-hidden border-y border-border bg-card py-1.5"
      role="marquee"
      aria-label="Most traded securities ticker"
    >
      <div className="ticker-track flex w-max whitespace-nowrap">
        <div aria-hidden="false">{strip}</div>
        <div aria-hidden="true">{strip}</div>
      </div>
      {/* Edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent" aria-hidden="true" />
    </div>
  )
}
