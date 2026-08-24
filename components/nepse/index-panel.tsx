"use client"

import { useState } from "react"
import useSWR from "swr"
import { isNepseIndex, nepseFetcher, LIVE_SWR_OPTS, type SubIndex, type IndexDetail } from "@/lib/nepse-client"
import { SectorHeatmap, type HeatTileDatum } from "./sector-heatmap"

export type SelectedSector = { id: number; name: string } | null

type PanelView = "map" | "list"

/** "Banking SubIndex" → "Banking", "Hydro Power Index" → "Hydro Power" */
function sectorName(index: string): string {
  return index.replace(/\s*(SubIndex|Sub Index|Index)\s*$/i, "").trim()
}

function changeTone(v: number): string {
  if (v > 0) return "text-gain"
  if (v < 0) return "text-loss"
  return "text-muted-foreground"
}

/**
 * Sector / sub-index board. Shares its selection with the Top Movers row so
 * clicking a sector filters every mover list to that sector.
 */
export function IndexPanel({
  selected,
  onSelect,
}: {
  selected: SelectedSector
  onSelect: (s: SelectedSector) => void
}) {
  const { data } = useSWR<SubIndex[]>("/api/nepse/sectors", nepseFetcher, LIVE_SWR_OPTS)
  const { data: indexes } = useSWR<IndexDetail[]>("/api/nepse/index", nepseFetcher, LIVE_SWR_OPTS)

  const sectors = data ?? []
  const nepseFromSectors = sectors.find((s) => isNepseIndex(s.index))
  const nepseFromIndexes = indexes?.find((i) => isNepseIndex(i.index))

  const nepse: SubIndex | null =
    nepseFromSectors ??
    (nepseFromIndexes
      ? {
          id: nepseFromIndexes.id,
          index: nepseFromIndexes.index,
          change: nepseFromIndexes.change,
          perChange: nepseFromIndexes.perChange,
          currentValue: nepseFromIndexes.currentValue,
        }
      : null)

  const others = sectors
    .filter((s) => !isNepseIndex(s.index))
    .slice()
    .sort((a, b) => b.perChange - a.perChange)

  const rows = nepse ? [nepse, ...others] : others

  const [view, setView] = useState<PanelView>("map")

  // Tile area scales with |% change| — big movers dominate the map. The floor
  // keeps flat sectors visible instead of collapsing to zero-area slivers.
  // Gainers get a 2.5x weight boost so positive sectors claim the prime,
  // larger tiles — traders scan for what's working first. `others` is already
  // sorted by perChange desc, so gainers also occupy the top-left region.
  const heatData: HeatTileDatum[] = others.map((s) => ({
    id: s.id,
    name: sectorName(s.index),
    perChange: s.perChange,
    currentValue: s.currentValue,
    size: Math.max(Math.abs(s.perChange), 0.08) * (s.perChange > 0 ? 2.5 : 1),
  }))

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
      aria-label="Index and sector performance"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-terminal-head-foreground">
          Indices
        </h2>
        <div className="flex items-center gap-2">
          {selected ? (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-bold text-accent-foreground transition-opacity hover:opacity-80"
            >
              {selected.name} ×
            </button>
          ) : null}
          <div
            className="flex overflow-hidden rounded-md border border-border"
            role="tablist"
            aria-label="Index panel view"
          >
            {(
              [
                ["map", "Heatmap"],
                ["list", "Table"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  view === key
                    ? "bg-accent text-accent-foreground"
                    : "bg-transparent text-muted-foreground hover:text-card-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col gap-px bg-border p-px" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse bg-card" />
          ))}
        </div>
      ) : view === "map" ? (
        <>
          {/* NEPSE is the whole market, not a sector — pinned as a strip. */}
          {nepse ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-terminal-head px-4 py-1.5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary">NEPSE</span>
              <span className="ml-auto font-mono text-xs tabular-nums text-card-foreground">
                {nepse.currentValue.toFixed(2)}
              </span>
              <span className={`font-mono text-xs font-bold tabular-nums ${changeTone(nepse.perChange)}`}>
                {nepse.perChange > 0 ? "+" : ""}
                {nepse.perChange.toFixed(2)}%
              </span>
            </div>
          ) : null}
          <SectorHeatmap sectors={heatData} selected={selected} onSelect={onSelect} />
        </>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-terminal-head px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="flex-1">Index</span>
            <span className="w-20 text-right">Value</span>
            <span className="w-16 text-right">% Chg</span>
          </div>
          <ul className="terminal-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
            {rows.map((s) => {
              const isNepse = isNepseIndex(s.index)
              const isSelected = !isNepse && selected?.id === s.id
              // Bar opacity scales with |% change|, saturating at 3%.
              const magnitude = Math.min(Math.abs(s.perChange) / 3, 1)
              return (
                <li key={s.id} className="border-b border-border/60 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (isNepse || isSelected) {
                        onSelect(null)
                      } else {
                        onSelect({ id: s.id, name: sectorName(s.index) })
                      }
                    }}
                    aria-pressed={isSelected}
                    className={`relative flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs transition-colors ${
                      isSelected ? "bg-accent" : "hover:bg-secondary"
                    }`}
                    title={
                      isNepse
                        ? "NEPSE Index — market-wide top lists"
                        : `Filter top movers by ${sectorName(s.index)}`
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-1 left-0 w-0.5 rounded-r ${
                        s.perChange > 0 ? "bg-gain" : s.perChange < 0 ? "bg-loss" : "bg-border"
                      }`}
                      style={{ opacity: 0.25 + magnitude * 0.75 }}
                    />
                    <span
                      className={`flex-1 truncate font-semibold ${
                        isNepse || isSelected ? "text-primary" : "text-card-foreground"
                      }`}
                    >
                      {isNepse ? "NEPSE Index" : sectorName(s.index)}
                    </span>
                    <span className="w-20 shrink-0 text-right font-mono tabular-nums text-card-foreground">
                      {s.currentValue.toFixed(2)}
                    </span>
                    <span
                      className={`w-16 shrink-0 text-right font-mono font-bold tabular-nums ${changeTone(s.perChange)}`}
                    >
                      {s.perChange > 0 ? "+" : ""}
                      {s.perChange.toFixed(2)}%
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
