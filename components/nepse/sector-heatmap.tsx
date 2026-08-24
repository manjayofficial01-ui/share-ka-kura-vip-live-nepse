"use client"

import { ResponsiveContainer, Treemap, Tooltip } from "recharts"
import type { SubIndex } from "@/lib/nepse-client"
import type { SelectedSector } from "./index-panel"

/**
 * Finviz-style sector heatmap. Tile AREA scales with the size of the move
 * (bigger movers dominate the map) and tile COLOR encodes direction +
 * intensity, saturating at ±2.5%. Clicking a tile toggles the shared sector
 * filter, exactly like clicking a row in the table view.
 */

export type HeatTileDatum = {
  id: number
  name: string
  perChange: number
  currentValue: number
  /** Treemap sizing weight — |% change| with a floor so flat sectors stay visible. */
  size: number
}

/** Saturation point: a ±2.5% sector move renders at full color. */
const SATURATE_PCT = 2.5

function tileFill(perChange: number): string {
  const magnitude = Math.min(Math.abs(perChange) / SATURATE_PCT, 1)
  if (perChange === 0) return "color-mix(in oklab, var(--muted-foreground) 16%, var(--card))"
  const base = perChange > 0 ? "var(--gain)" : "var(--loss)"
  // 14% floor keeps barely-moved sectors legible; 78% cap keeps text readable.
  const pct = Math.round(14 + magnitude * 64)
  return `color-mix(in oklab, ${base} ${pct}%, var(--card))`
}

function tileText(perChange: number): string {
  const magnitude = Math.min(Math.abs(perChange) / SATURATE_PCT, 1)
  if (magnitude > 0.45) return "#f5f8fd"
  if (perChange > 0) return "var(--gain-surface-foreground)"
  if (perChange < 0) return "var(--loss-surface-foreground)"
  return "var(--muted-foreground)"
}

type TileProps = {
  x?: number
  y?: number
  width?: number
  height?: number
  name?: string
  id?: number
  perChange?: number
  currentValue?: number
  selectedId?: number | null
  onTileClick?: (id: number, name: string) => void
}

function HeatTile(props: TileProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, id, perChange, currentValue, selectedId, onTileClick } = props

  // Recharts renders a root node covering the whole chart with no datum.
  if (typeof perChange !== "number" || typeof id !== "number" || !name) return null
  if (width <= 0 || height <= 0) return null

  const isSelected = selectedId === id
  const showName = width > 68 && height > 40
  const showPct = width > 44 && height > 26
  const pctLabel = `${perChange > 0 ? "+" : ""}${perChange.toFixed(2)}%`
  const fg = tileText(perChange)

  return (
    <g
      onClick={() => onTileClick?.(id, name)}
      style={{ cursor: "pointer" }}
      role="button"
      aria-label={`${name} ${pctLabel}, index ${currentValue?.toFixed(2) ?? ""}`}
    >
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        rx={4}
        fill={tileFill(perChange)}
        stroke={isSelected ? "var(--gold)" : "var(--border)"}
        strokeWidth={isSelected ? 2 : 1}
      />
      {showName ? (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 7}
            textAnchor="middle"
            fill={fg}
            fontSize={Math.min(13, Math.max(10, width / 11))}
            fontWeight={700}
            fontFamily="var(--font-sans)"
          >
            {name.length > Math.floor(width / 7) ? `${name.slice(0, Math.floor(width / 7) - 1)}…` : name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 11}
            textAnchor="middle"
            fill={fg}
            fontSize={Math.min(14, Math.max(10, width / 10))}
            fontWeight={700}
            fontFamily="var(--font-mono)"
          >
            {pctLabel}
          </text>
        </>
      ) : showPct ? (
        <text
          x={x + width / 2}
          y={y + height / 2 + 3.5}
          textAnchor="middle"
          fill={fg}
          fontSize={10}
          fontWeight={700}
          fontFamily="var(--font-mono)"
        >
          {pctLabel}
        </text>
      ) : null}
    </g>
  )
}

export function SectorHeatmap({
  sectors,
  selected,
  onSelect,
}: {
  sectors: HeatTileDatum[]
  selected: SelectedSector
  onSelect: (s: SelectedSector) => void
}) {
  const handleTileClick = (id: number, name: string) => {
    if (selected?.id === id) onSelect(null)
    else onSelect({ id, name })
  }

  return (
    <div className="min-h-0 flex-1 p-1.5">
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={sectors}
          dataKey="size"
          nameKey="name"
          aspectRatio={4 / 3}
          isAnimationActive={false}
          content={<HeatTile selectedId={selected?.id ?? null} onTileClick={handleTileClick} />}
        >
          <Tooltip
            content={({ payload }) => {
              const d = payload?.[0]?.payload as HeatTileDatum | undefined
              if (!d) return null
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 font-mono text-[11px] text-popover-foreground">
                  <p className="font-bold">{d.name}</p>
                  <p className="tabular-nums text-muted-foreground">
                    {d.currentValue.toFixed(2)}{" "}
                    <span className={d.perChange > 0 ? "text-gain" : d.perChange < 0 ? "text-loss" : ""}>
                      {d.perChange > 0 ? "+" : ""}
                      {d.perChange.toFixed(2)}%
                    </span>
                  </p>
                </div>
              )
            }}
          />
        </Treemap>
      </ResponsiveContainer>
    </div>
  )
}
