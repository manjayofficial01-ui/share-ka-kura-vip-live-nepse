"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { nepseFetcher, type SecurityBrief } from "@/lib/nepse-client"
import { SymbolDetail } from "./symbol-detail"

const PAGE_SIZE = 25

export function SecuritiesTable() {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<{ id: number; symbol: string } | null>(null)
  const [visible, setVisible] = useState(PAGE_SIZE)

  const { data, error, isLoading } = useSWR<SecurityBrief[]>("/api/nepse/securities", nepseFetcher, {
    revalidateOnFocus: false,
  })

  const filtered = useMemo(() => {
    if (!data) return []
    const active = data.filter((s) => s.activeStatus === "A")
    const q = query.trim().toLowerCase()
    if (!q) return active
    return active.filter(
      (s) => s.symbol.toLowerCase().includes(q) || s.securityName.toLowerCase().includes(q),
    )
  }, [data, query])

  const shown = filtered.slice(0, visible)

  return (
    <section className="flex flex-col gap-4" aria-label="Listed securities">
      {selected ? (
        <SymbolDetail securityId={selected.id} symbol={selected.symbol} onClose={() => setSelected(null)} />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <label htmlFor="security-search" className="sr-only">
          Search securities
        </label>
        <input
          id="security-search"
          type="search"
          placeholder="Search by symbol or company…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setVisible(PAGE_SIZE)
          }}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {!isLoading && data ? (
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{filtered.length}</span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 bg-card px-4 py-3">
              <div className="h-4 w-16 rounded bg-muted" />
              <div className="h-4 flex-1 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : error || !data ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Could not load the securities list. NEPSE may be temporarily unavailable — refresh to retry.
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {shown.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected({ id: s.id, symbol: s.symbol })}
                  className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors ${
                    selected?.symbol === s.symbol ? "bg-muted" : "bg-card hover:bg-muted/60"
                  }`}
                >
                  <span className="w-20 shrink-0 font-mono text-sm font-medium text-card-foreground">{s.symbol}</span>
                  <span className="truncate text-sm text-muted-foreground">{s.securityName}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                No securities match &quot;{query}&quot;
              </li>
            ) : null}
          </ul>

          {filtered.length > visible ? (
            <button
              type="button"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="self-center rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Show more ({filtered.length - visible} remaining)
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}
