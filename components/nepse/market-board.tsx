"use client"

import { useState } from "react"
import { IndexChart } from "./index-chart"
import { IndexPanel, type SelectedSector } from "./index-panel"
import { TopMovers } from "./top-movers"

/**
 * Owns the sector-filter selection shared by the Indices panel (row 1) and the
 * Top Movers columns (row 2), which are separated in the layout and so can't
 * hold the state between themselves.
 */
export function MarketBoard() {
  const [selected, setSelected] = useState<SelectedSector>(null)

  return (
    <div className="flex flex-col gap-5">
      {/*
        Row 1 — chart and indices inline at a shared, explicit height.
        The height must be fixed rather than h-full: Recharts' ResponsiveContainer
        reports its measured size upward, so an auto grid row track would grow to
        fit the chart and both cards would spill over the next section.
      */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="h-80 min-h-0 lg:col-span-3 lg:h-96">
          <IndexChart />
        </div>
        <div className="h-80 min-h-0 lg:col-span-2 lg:h-96">
          <IndexPanel selected={selected} onSelect={setSelected} />
        </div>
      </div>

      {/* Row 2 — five mover columns spanning the full width */}
      <TopMovers selected={selected} />
    </div>
  )
}
