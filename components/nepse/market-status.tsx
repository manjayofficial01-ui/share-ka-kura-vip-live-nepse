"use client"

import useSWR from "swr"
import { nepseFetcher, type MarketStatus } from "@/lib/nepse-client"

export function MarketStatusPill() {
  const { data, isLoading } = useSWR<MarketStatus>("/api/nepse/status", nepseFetcher, {
    refreshInterval: 60_000,
  })

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
        Checking…
      </span>
    )
  }

  const isOpen = data?.isOpen === "OPEN"

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium"
      role="status"
    >
      <span
        className={`size-1.5 rounded-full ${isOpen ? "bg-gain animate-pulse" : "bg-loss"}`}
        aria-hidden="true"
      />
      <span className={isOpen ? "text-gain" : "text-loss"}>{isOpen ? "Market Open" : "Market Closed"}</span>
      {data?.asOf ? (
        <span className="hidden text-muted-foreground sm:inline font-mono">
          {new Date(data.asOf).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </span>
      ) : null}
    </span>
  )
}
