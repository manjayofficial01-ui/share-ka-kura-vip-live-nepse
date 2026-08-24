"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { Megaphone, X, ExternalLink } from "lucide-react"
import { nepseFetcher, type Disclosure } from "@/lib/nepse-client"

/** "2026-08-06T15:59:19.227" → "2026-08-06 15:59" */
function formatDisclosureDate(iso: string | null): string {
  if (!iso) return ""
  const [date, time] = iso.split("T")
  return time ? `${date} ${time.slice(0, 5)}` : date
}

/**
 * Corporate disclosures moved off the board into a floating action button so
 * the terminal grid stays dedicated to price data.
 */
export function DisclosuresFab() {
  const [open, setOpen] = useState(false)
  const { data } = useSWR<Disclosure[]>("/api/nepse/disclosures", nepseFetcher, { refreshInterval: 5 * 60_000 })

  const items = data ?? []

  // Escape closes the panel; body scroll locks while it's open on small screens.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={`Open corporate disclosures${items.length ? ` (${items.length} available)` : ""}`}
        className="fixed bottom-5 right-5 z-50 flex size-13 items-center justify-center rounded-full border border-primary/40 bg-primary text-primary-foreground shadow-lg shadow-background/60 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Megaphone className="size-5.5" aria-hidden="true" />
        {items.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full border border-background bg-loss px-1 font-mono text-[10px] font-bold tabular-nums text-primary-foreground">
            {items.length > 99 ? "99+" : items.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close disclosures"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="disclosures-title"
            className="absolute inset-x-3 bottom-3 top-auto flex max-h-[80dvh] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-96"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-terminal-head px-4 py-3">
              <div className="flex items-center gap-2">
                <Megaphone className="size-4 text-primary" aria-hidden="true" />
                <h2
                  id="disclosures-title"
                  className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-terminal-head-foreground"
                >
                  Disclosures
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {!data ? (
              <div className="flex flex-col gap-px bg-border p-px" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 animate-pulse bg-card" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No disclosures published.</p>
            ) : (
              <ul className="terminal-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
                {items.map((d) => (
                  <li key={d.id} className="border-b border-border/60 px-4 py-2.5 last:border-b-0">
                    <div className="flex items-center gap-2">
                      {d.symbol ? (
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                          {d.symbol}
                        </span>
                      ) : null}
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {formatDisclosureDate(d.publishedDate)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-card-foreground text-pretty">
                      {d.headline.trim()}
                    </p>
                    {d.attachmentUrl ? (
                      <a
                        href={d.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-primary hover:underline"
                      >
                        Attachment
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
