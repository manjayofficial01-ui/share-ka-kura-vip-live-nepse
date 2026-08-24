"use client"

import { useState } from "react"
import useSWR from "swr"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import {
  nepseFetcher,
  formatInt,
  formatNepali,
  formatRs,
  type BrokerFlow,
  type BrokerHoldingData,
  type BrokerHoldingPeriod,
} from "@/lib/nepse-client"

// ---------------------------------------------------------------------------
// Broker holding — who is accumulating vs distributing a stock over a window.
// Same view as nepsealpha.com/broker-holding. Primary source was
// chukul.com's public floorsheet aggregates (nepsealpha has no public API),
// but chukul gated /top-net-holding|release behind Bearer auth in late-2025
// (403). The section now tries chukul first and transparently falls back to
// NEPSE's official floorsheet (intraday) with broker-name enrichment via
// chukul's still-public /api/broker/ directory. See lib/broker-holding.ts.
// ---------------------------------------------------------------------------

function formatRangeDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function kittaTick(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}K`
  return String(v)
}

function FlowTooltip({
  active,
  payload,
  side,
}: {
  active?: boolean
  payload?: Array<{ payload: BrokerFlow }>
  side: "holding" | "selling"
}) {
  if (!active || !payload?.length) return null
  const f = payload[0].payload
  return (
    <div className="max-w-[220px] rounded-md border border-border bg-card px-2.5 py-2 font-mono text-[11px] shadow-md">
      <p className="font-bold text-card-foreground">Broker {f.broker}</p>
      {f.brokerName ? <p className="mt-0.5 font-sans text-[10px] leading-snug text-muted-foreground">{f.brokerName}</p> : null}
      <div className="mt-1.5 flex flex-col gap-0.5 tabular-nums">
        <p className={side === "holding" ? "text-gain" : "text-loss"}>
          {side === "holding" ? "Net bought" : "Net sold"}: {formatInt(f.quantity)} Kitta
        </p>
        {f.avgRate !== null ? <p className="text-muted-foreground">Avg rate: Rs {formatRs(f.avgRate)}</p> : null}
        <p className="text-muted-foreground">Net amount: Rs {formatNepali(f.amount)}</p>
      </div>
    </div>
  )
}

function FlowChart({
  title,
  subtitle,
  flows,
  side,
}: {
  title: string
  subtitle: string
  flows: BrokerFlow[]
  side: "holding" | "selling"
}) {
  const color = side === "holding" ? "var(--color-gain)" : "var(--color-loss)"
  // nepsealpha sorts holding descending and selling ascending — mirror that.
  const data = side === "holding" ? flows : [...flows].reverse()

  return (
    <figure className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-row-alt/40 p-3">
      <figcaption className="flex flex-col gap-0.5">
        <span className={`text-xs font-bold ${side === "holding" ? "text-gain" : "text-loss"}`}>{title}</span>
        <span className="text-[10px] text-muted-foreground">{subtitle}</span>
      </figcaption>
      {data.length > 0 ? (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="broker"
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)", fontFamily: "var(--font-mono)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                interval={0}
                label={{
                  value: "Broker No.",
                  position: "insideBottom",
                  offset: -2,
                  fontSize: 9,
                  fill: "var(--color-muted-foreground)",
                }}
                height={32}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)", fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={kittaTick}
                label={{
                  value: "Qty (Kitta)",
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 9,
                  fill: "var(--color-muted-foreground)",
                }}
              />
              <Tooltip content={<FlowTooltip side={side} />} cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} />
              <Bar dataKey="quantity" radius={[3, 3, 0, 0]} maxBarSize={36}>
                {data.map((f) => (
                  <Cell key={f.broker} fill={color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-52 items-center justify-center px-4 text-center">
          <p className="text-xs text-muted-foreground text-pretty">
            No {side === "holding" ? "net accumulation" : "net distribution"} recorded in this period.
          </p>
        </div>
      )}
    </figure>
  )
}

const PERIODS: Array<{ value: BrokerHoldingPeriod; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]

export function BrokerHoldingSection({ symbol }: { symbol: string }) {
  const [period, setPeriod] = useState<BrokerHoldingPeriod>("weekly")

  const { data, error, isLoading } = useSWR<BrokerHoldingData>(
    `/api/nepse/broker-holding/${encodeURIComponent(symbol)}?period=${period}`,
    nepseFetcher,
    { refreshInterval: 5 * 60_000, revalidateOnFocus: false, keepPreviousData: true },
  )

  const range = data ? `${formatRangeDate(data.fromDate)} – ${formatRangeDate(data.toDate)}` : null

  return (
    <section
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      aria-label={`${symbol} broker holding`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-terminal-head px-3 py-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-terminal-head-foreground">
          Broker Holding
        </h3>
        <div className="flex items-center gap-2">
          {range ? <span className="hidden text-[10px] font-medium text-terminal-head-foreground/80 sm:inline">{range}</span> : null}
          <div
            className="flex overflow-hidden rounded border border-terminal-head-foreground/25"
            role="group"
            aria-label="Broker holding period"
          >
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                aria-pressed={period === p.value}
                className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  period === p.value
                    ? "bg-primary text-primary-foreground"
                    : "text-terminal-head-foreground/80 hover:bg-terminal-head-foreground/10"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isLoading && !data ? (
        <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2" aria-hidden="true">
          <div className="h-64 animate-pulse rounded-md bg-muted" />
          <div className="h-64 animate-pulse rounded-md bg-muted" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2.5 px-3 py-3">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
          <p className="text-xs text-muted-foreground text-pretty">
            Could not load broker holding data right now — it will retry automatically.
          </p>
        </div>
      ) : data ? (
        <div className="flex flex-col gap-2 p-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <FlowChart
              title={`Top Broker Holding · ${symbol}`}
              subtitle="Total buy − total sales (accumulating)"
              flows={data.holding}
              side="holding"
            />
            <FlowChart
              title={`Top Broker Selling · ${symbol}`}
              subtitle="Sales exceeding purchase (distributing)"
              flows={data.selling}
              side="selling"
            />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Net broker positions derived from floor sheet buyer/seller records ({range}) — NEPSE anonymizes brokers
            while the market is open, so intraday charts show the last visible after-close snapshot when available. Hover a bar for
            the brokerage name, average rate, and net amount. Source: NEPSE (floorsheet) · broker names via chukul.com.
          </p>
        </div>
      ) : null}
    </section>
  )
}
