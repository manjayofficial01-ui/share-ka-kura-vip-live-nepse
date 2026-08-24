"use client"

import useSWR from "swr"
import { nepseFetcher, formatRs, matchesIndexName, LIVE_SWR_OPTS, type IndexDetail } from "@/lib/nepse-client"

/** Indexes shown prominently; the rest collapse into the secondary strip. */
const FEATURED = ["NEPSE Index", "Sensitive Index", "Float Index"]

function ChangeBadge({ change, perChange }: { change: number; perChange: number }) {
  const up = change > 0
  const flat = change === 0
  const tone = flat ? "text-muted-foreground" : up ? "text-gain" : "text-loss"
  const sign = up ? "+" : ""

  return (
    <span className={`font-mono text-sm ${tone}`}>
      {sign}
      {formatRs(change)} ({sign}
      {perChange.toFixed(2)}%)
    </span>
  )
}

export function IndexOverview() {
  const { data, error, isLoading } = useSWR<IndexDetail[]>("/api/nepse/index", nepseFetcher, LIVE_SWR_OPTS)

  if (isLoading) {
    return (
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 bg-card p-4">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-7 w-32 rounded bg-muted" />
            <div className="h-3 w-28 rounded bg-muted" />
          </div>
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Could not load index data from NEPSE. It may be temporarily unavailable — this happens often with their
        servers. Data will retry automatically.
      </div>
    )
  }

  const featured = FEATURED.map((name) => data.find((d) => matchesIndexName(d.index, name))).filter(
    (d): d is IndexDetail => Boolean(d),
  )
  const secondary = data.filter((d) => !FEATURED.some((name) => matchesIndexName(d.index, name)))

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {featured.map((idx) => (
          <div key={idx.id} className="flex flex-col gap-1 bg-card p-4">
            <span className="text-xs text-muted-foreground">{idx.index}</span>
            <span className="font-mono text-2xl font-semibold tabular-nums text-card-foreground">
              {formatRs(idx.currentValue)}
            </span>
            <ChangeBadge change={idx.change} perChange={idx.perChange} />
          </div>
        ))}
      </div>

      {secondary.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto pb-1" role="list" aria-label="Sub-indexes">
          {secondary.map((idx) => {
            const up = idx.change > 0
            const flat = idx.change === 0
            return (
              <div key={idx.id} role="listitem" className="flex shrink-0 items-baseline gap-2 text-xs">
                <span className="text-muted-foreground">{idx.index}</span>
                <span className="font-mono tabular-nums">{formatRs(idx.currentValue)}</span>
                <span className={`font-mono ${flat ? "text-muted-foreground" : up ? "text-gain" : "text-loss"}`}>
                  {up ? "+" : ""}
                  {idx.perChange.toFixed(2)}%
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
