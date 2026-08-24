"use client"

import useSWR from "swr"
import { Area, Bar, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { nepseFetcher, formatRs, formatNepali, type IndexGraphs } from "@/lib/nepse-client"
import { useLiveMarket } from "@/lib/use-live-market"

function formatTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kathmandu",
  })
}

/** Advanced / unchanged / declined shown as one proportional breadth bar. */
function BreadthBar({
  advanced,
  declined,
  unchanged,
}: {
  advanced: number | null
  declined: number | null
  unchanged: number | null
}) {
  const a = advanced ?? 0
  const d = declined ?? 0
  const u = unchanged ?? 0
  const total = a + d + u

  // Each label column shares its segment's proportional width so the count
  // sits directly under its slice of the bar. min-w keeps a sliver segment's
  // count from being crushed; the anchor (start/center/end) matches where the
  // segment actually sits within its column.
  const segments = [
    { key: "adv", count: a, label: "Adv", display: advanced, dot: "bg-gain", text: "text-gain", align: "justify-start" },
    {
      key: "unch",
      count: u,
      label: "Unch",
      display: unchanged,
      dot: "bg-muted-foreground",
      text: "text-muted-foreground",
      align: "justify-center",
    },
    { key: "dec", count: d, label: "Dec", display: declined, dot: "bg-loss", text: "text-loss", align: "justify-end" },
  ] as const

  return (
    <div
      className="flex shrink-0 flex-col gap-1.5 border-t border-border px-4 py-2.5"
      role="group"
      aria-label="Market breadth"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        Market Breadth
      </span>
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        {total > 0 ? (
          <>
            <div className="h-full bg-gain" style={{ width: `${(a / total) * 100}%` }} />
            <div className="h-full bg-muted-foreground/50" style={{ width: `${(u / total) * 100}%` }} />
            <div className="h-full bg-loss" style={{ width: `${(d / total) * 100}%` }} />
          </>
        ) : null}
      </div>
      <div className="flex w-full gap-px font-mono text-xs tabular-nums">
        {segments.map((s) => (
          <span
            key={s.key}
            className={`flex min-w-fit items-center gap-1.5 ${s.align} ${s.text}`}
            style={{ width: total > 0 ? `${(s.count / total) * 100}%` : "33.3%" }}
          >
            <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${s.dot}`} />
            {s.display ?? "—"} <span className="hidden text-muted-foreground sm:inline">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function IndexChart() {
  const { data: graph } = useSWR<IndexGraphs>("/api/nepse/graph", nepseFetcher, { refreshInterval: 30_000 })
  // Shared hook — never poll /api/nepse/live directly or the intervals conflict.
  const { rows: live } = useLiveMarket()

  const advanced = live ? live.filter((s) => s.percentageChange > 0).length : null
  const declined = live ? live.filter((s) => s.percentageChange < 0).length : null
  const unchanged = live ? live.filter((s) => s.percentageChange === 0).length : null

  // Volume samples are bucketed to the minute server-side; index ticks are
  // also per-minute epochs, so a minute-floor join lines the bars up under
  // their price ticks. Direction (vs previous tick) colors each bar.
  const volByMinute = new Map<number, number>()
  for (const [t, vol] of graph?.volume ?? []) {
    const minute = Math.floor(t / 60) * 60
    volByMinute.set(minute, (volByMinute.get(minute) ?? 0) + vol)
  }

  const raw = graph?.nepse ?? []
  const points = raw.map(([t, v], i) => ({
    t,
    v,
    vol: volByMinute.get(Math.floor(t / 60) * 60) ?? 0,
    up: i === 0 ? true : v >= raw[i - 1][1],
  }))
  const hasGraph = points.length > 1
  const hasVolume = points.some((p) => p.vol > 0)

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
      aria-label="NEPSE index intraday chart"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-terminal-head-foreground">
          Intraday · NEPSE
        </h2>
        {hasGraph ? (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {points.length} ticks{hasVolume ? " · vol" : ""} · NPT
          </span>
        ) : null}
      </header>

      {/* min-h-0 + overflow-hidden keep Recharts' measured height from pushing
          the card past the fixed row height set by MarketBoard. */}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        {hasGraph ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 16, right: 12, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="indexFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-chart-fill)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--color-chart-fill)" stopOpacity={0.02} />
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
                yAxisId="price"
                domain={["dataMin - 5", "dataMax + 5"]}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v: number) => v.toFixed(0)}
              />
              {/* Hidden axis stretched ~4.5x so volume bars hug the bottom
                  fifth of the plot without crowding the price line. */}
              <YAxis yAxisId="vol" hide domain={[0, (dataMax: number) => Math.max(dataMax, 1) * 4.5]} />
              <Tooltip
                formatter={(value, name) => {
                  if (name === "Volume") {
                    return Number(value) > 0 ? [`${formatNepali(Number(value))} shares`, "Volume"] : [null, null]
                  }
                  return [formatRs(Number(value)), "NEPSE"]
                }}
                labelFormatter={(t) => `${formatTime(Number(t))} NPT`}
                contentStyle={{
                  backgroundColor: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-popover-foreground)",
                }}
              />
              {hasVolume ? (
                <Bar yAxisId="vol" dataKey="vol" name="Volume" isAnimationActive={false} maxBarSize={8}>
                  {points.map((p) => (
                    <Cell key={p.t} fill={p.up ? "var(--color-gain)" : "var(--color-loss)"} fillOpacity={0.45} />
                  ))}
                </Bar>
              ) : null}
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="v"
                name="NEPSE"
                stroke="var(--color-primary)"
                strokeWidth={1.75}
                fill="url(#indexFill)"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-10 text-center">
            <p className="text-sm font-medium text-muted-foreground">Intraday chart unavailable</p>
            <p className="text-xs text-muted-foreground/70 text-pretty">
              NEPSE publishes index graph data only while the market is open (11:00–15:00 NPT, Mon–Fri).
            </p>
          </div>
        )}
      </div>

      <BreadthBar advanced={advanced} declined={declined} unchanged={unchanged} />
    </section>
  )
}
