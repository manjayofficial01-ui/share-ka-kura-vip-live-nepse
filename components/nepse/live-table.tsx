"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { RefreshCw } from "lucide-react"
import { formatRs, formatInt, formatNepali, nepseFetcher, type LiveMarketRow, type MarketStatus } from "@/lib/nepse-client"
import { useLiveMarket, useSecondsSince } from "@/lib/use-live-market"
import { SymbolDetail } from "./symbol-detail"

type SortKey =
  | "symbol"
  | "ltp"
  | "ltv"
  | "pointChange"
  | "change"
  | "open"
  | "high"
  | "low"
  | "avg"
  | "volume"
  | "turnover"
  | "prevClose"
  | "updated"

type SortDir = "asc" | "desc"

const COLUMNS: { key: SortKey | null; label: string; align: "left" | "right" }[] = [
  { key: null, label: "SN", align: "left" },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "ltp", label: "LTP", align: "right" },
  { key: "ltv", label: "LTV", align: "right" },
  { key: "pointChange", label: "Pt. Chg", align: "right" },
  { key: "change", label: "% Chg", align: "right" },
  { key: "open", label: "Open", align: "right" },
  { key: "high", label: "High", align: "right" },
  { key: "low", label: "Low", align: "right" },
  { key: "avg", label: "Avg", align: "right" },
  { key: "volume", label: "Volume", align: "right" },
  { key: "turnover", label: "Turnover", align: "right" },
  { key: "prevClose", label: "Prev Close", align: "right" },
  { key: "updated", label: "LTT", align: "right" },
]

/** "2026-08-07 14:59:59.076613" → "14:59:59" (last traded time, NPT). */
function tradeTime(value: string | null | undefined): string {
  if (!value) return "—"
  const match = /[T ](\d{2}:\d{2}:\d{2})/.exec(value)
  return match ? match[1] : "—"
}

function sortValue(s: LiveMarketRow, key: SortKey): number | string {
  switch (key) {
    case "symbol":
      return s.symbol
    case "ltp":
      return s.lastTradedPrice
    case "ltv":
      return s.lastTradedVolume ?? 0
    case "pointChange":
      return s.lastTradedPrice - s.previousClose
    case "change":
      return s.percentageChange
    case "open":
      return s.openPrice
    case "high":
      return s.highPrice
    case "low":
      return s.lowPrice
    case "avg":
      return s.averageTradedPrice
    case "volume":
      return s.totalTradeQuantity
    case "turnover":
      return s.totalTradeValue
    case "prevClose":
      return s.previousClose
    case "updated":
      return s.lastUpdatedDateTime ?? ""
  }
}

export function LiveTable() {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<{ securityId: number; symbol: string } | null>(null)
  // Default mirrors nepalstock.com/live-market: most recently traded scrips
  // first, so the top of the board churns with actual trades instead of being
  // permanently pinned to the highest-priced/turnover giants.
  const [sort, setSort] = useState<SortKey>("updated")
  const [dir, setDir] = useState<SortDir>("desc")

  const { rows, ticks, changedAt, feedTime, feedStampMs, isLoading, isValidating, error, refresh } = useLiveMarket()
  const secondsSinceChange = useSecondsSince(changedAt)
  const feedAge = useSecondsSince(feedStampMs)

  // After the session ends, the feed serves the day's closing snapshot — the
  // whole section flips to "Today's Price" mode (like nepalstock.com/today-price)
  // instead of pretending to still be a live board.
  const { data: status } = useSWR<MarketStatus>("/api/nepse/status", nepseFetcher, { refreshInterval: 60_000 })
  const marketClosed = status ? status.isOpen !== "OPEN" : false

  // Today's Price lists scrips alphabetically; mirror that when the session
  // ends — but never override a sort the user picked themselves.
  const userSorted = useRef(false)
  useEffect(() => {
    if (marketClosed && !userSorted.current) {
      setSort("symbol")
      setDir("asc")
    }
  }, [marketClosed])

  // Business date of the closed data (from the rows' own timestamps).
  const businessDate = useMemo(() => {
    if (!marketClosed || !rows?.length) return null
    const stamp = rows.find((r) => r.lastUpdatedDateTime)?.lastUpdatedDateTime
    const match = stamp ? /^(\d{4}-\d{2}-\d{2})/.exec(stamp.replace("T", " ")) : null
    return match ? match[1] : null
  }, [marketClosed, rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    const list = q
      ? rows.filter((s) => s.symbol.toLowerCase().includes(q) || s.securityName.toLowerCase().includes(q))
      : [...rows]
    const mult = dir === "asc" ? 1 : -1
    list.sort((a, b) => {
      const av = sortValue(a, sort)
      const bv = sortValue(b, sort)
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * mult
      return ((av as number) - (bv as number)) * mult
    })
    return list
  }, [rows, query, sort, dir])

  // Aggregate footer totals across the whole (unfiltered-by-page) result set.
  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => {
        acc.volume += s.totalTradeQuantity
        acc.turnover += s.totalTradeValue
        return acc
      },
      { volume: 0, turnover: 0 },
    )
  }, [filtered])

  function toggleSort(key: SortKey) {
    userSorted.current = true
    if (key === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSort(key)
      setDir(key === "symbol" ? "asc" : "desc")
    }
  }

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={marketClosed ? "Today's price" : "Real time NEPSE live data"}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`size-2 rounded-full ${
              marketClosed ? "bg-muted-foreground/60" : isValidating ? "live-dot bg-gain" : "bg-gain/60"
            }`}
            aria-hidden="true"
          />
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-terminal-head-foreground">
            {marketClosed ? "Today's Price" : "Real Time NEPSE Live Data"}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {marketClosed ? (
            <span role="status">
              <span className="font-bold text-loss">Market closed</span>
              {businessDate ? ` — closing prices for ${businessDate}` : " — last session's closing prices"}
            </span>
          ) : feedTime ? (
            /* Report the snapshot's own age, not how recently we polled. NEPSE
               publishes once a minute, so a 60s-old snapshot is normal and must
               never masquerade as a live tick; past ~100s it really is stale. */
            <span role="status" aria-label={`Data as of ${feedTime} Nepal time${feedAge === null ? "" : `, ${feedAge} seconds old`}`}>
              as of {feedTime}
              {feedAge !== null ? (
                <span className={feedAge > 100 ? "ml-1 text-loss" : "ml-1 opacity-70"}>· {feedAge}s ago</span>
              ) : null}
              <span className="ml-1 opacity-70">(NEPSE publishes ~1×/min)</span>
            </span>
          ) : null}
          {rows ? <span>{formatInt(rows.length)} scrips</span> : null}
          {!marketClosed && secondsSinceChange !== null ? (
            <span
              className={secondsSinceChange <= 10 ? "text-gain" : ""}
              role="status"
              aria-label={`Last price change ${secondsSinceChange} seconds ago`}
            >
              ● tick {secondsSinceChange}s ago
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
          <label htmlFor="security-search" className="sr-only">
            Search securities
          </label>
          <input
            id="security-search"
            type="search"
            placeholder="Search symbol or company…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
          />
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh live data now"
            className="shrink-0 rounded-md border border-input p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw className={`size-3.5 ${isValidating ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {isLoading && !rows ? (
        <div className="flex flex-col gap-px bg-border p-px" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse bg-card" />
          ))}
        </div>
      ) : error && !rows ? (
        <div className="p-4 text-sm text-muted-foreground">
          Could not load live market data. NEPSE may be temporarily unavailable — it retries automatically.
        </div>
      ) : (
        <>
          {/* Full data set rendered at full height — every row is visible on
              the page without a nested scroll region (horizontal overflow only
              kicks in on narrow screens). */}
          <div className="terminal-scroll overflow-x-auto">
            <table className="w-full min-w-[1220px] border-collapse text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-terminal-head">
                  {COLUMNS.map((col) => {
                    const active = col.key !== null && col.key === sort
                    // After close the LTP column holds NEPSE's official close price.
                    const label = marketClosed && col.key === "ltp" ? "Close" : col.label
                    return (
                      <th
                        key={col.label}
                        scope="col"
                        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                        className={`whitespace-nowrap border-b border-border px-2.5 py-2 font-mono text-[10px] font-bold uppercase tracking-wider ${
                          col.align === "right" ? "text-right" : "text-left"
                        } ${active ? "text-terminal-head-foreground" : "text-muted-foreground"}`}
                      >
                        {col.key ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key as SortKey)}
                            className="inline-flex items-center gap-1 transition-colors hover:text-terminal-head-foreground"
                          >
                            {label}
                            {active ? <span aria-hidden="true">{dir === "asc" ? "▲" : "▼"}</span> : null}
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => {
                  const up = s.percentageChange > 0
                  const flat = s.percentageChange === 0
                  const pointChange = s.lastTradedPrice - s.previousClose
                  const changeTone = flat ? "text-muted-foreground" : up ? "text-gain" : "text-loss"
                  const edge = flat ? "border-l-transparent" : up ? "border-l-gain/70" : "border-l-loss/70"
                  const tick = ticks.get(s.securityId)
                  return (
                    <tr
                      key={s.securityId}
                      onClick={() => setSelected({ securityId: Number(s.securityId), symbol: s.symbol })}
                      className={`cursor-pointer border-b border-border/50 border-l-2 font-mono tabular-nums text-card-foreground transition-colors even:bg-row-alt/50 hover:bg-secondary ${edge}`}
                      title={s.securityName}
                    >
                      <td className="px-2.5 py-1.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-2.5 py-1.5 font-sans text-xs font-bold tracking-wide">{s.symbol}</td>
                      {/* Remounting on LTP change restarts the directional flash */}
                      <td
                        key={`${s.securityId}:${s.lastTradedPrice}`}
                        className={`px-2.5 py-1.5 text-right font-semibold ${
                          tick === 1 ? "tick-up" : tick === -1 ? "tick-down" : ""
                        }`}
                      >
                        {formatRs(s.lastTradedPrice)}
                      </td>
                      <td className="px-2.5 py-1.5 text-right text-muted-foreground">{formatInt(s.lastTradedVolume)}</td>
                      <td className={`px-2.5 py-1.5 text-right ${changeTone}`}>
                        {up ? "+" : ""}
                        {formatRs(pointChange)}
                      </td>
                      <td className={`px-2.5 py-1.5 text-right font-bold ${changeTone}`}>
                        {up ? "+" : ""}
                        {s.percentageChange.toFixed(2)}%
                      </td>
                      <td className="px-2.5 py-1.5 text-right">{formatRs(s.openPrice)}</td>
                      <td className="px-2.5 py-1.5 text-right text-gain/90">{formatRs(s.highPrice)}</td>
                      <td className="px-2.5 py-1.5 text-right text-loss/90">{formatRs(s.lowPrice)}</td>
                      <td className="px-2.5 py-1.5 text-right">{formatRs(s.averageTradedPrice)}</td>
                      <td className="px-2.5 py-1.5 text-right">{formatInt(s.totalTradeQuantity)}</td>
                      <td className="px-2.5 py-1.5 text-right">{formatNepali(s.totalTradeValue)}</td>
                      <td className="px-2.5 py-1.5 text-right text-muted-foreground">{formatRs(s.previousClose)}</td>
                      <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                        {tradeTime(s.lastUpdatedDateTime)}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-2 py-6 text-center text-muted-foreground">
                      {query.trim()
                        ? `No securities match "${query}"`
                        : "No market data available right now — NEPSE trades 11:00–15:00 NPT, Mon–Fri. The last session's closing data appears here once NEPSE serves it."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="tabular-nums">{filtered.length} scrips</span>
            <span className="tabular-nums">
              Volume {formatInt(totals.volume)} · Turnover Rs {formatNepali(totals.turnover)}
            </span>
          </div>
        </>
      )}

      {selected ? (
        <SymbolDetail securityId={selected.securityId} symbol={selected.symbol} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  )
}
