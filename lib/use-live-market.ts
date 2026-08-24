"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { nepseFetcher, LIVE_SWR_OPTS, LIVE_REFRESH_MS, type LiveMarketRow } from "@/lib/nepse-client"
import {
  computePollDelay,
  observeStamp,
  parseFeedStamp,
  newestRowStamp,
  type FeedPhase,
} from "@/lib/feed-clock"

/**
 * Single source of truth for NEPSE's lives-market feed.
 *
 * Every consumer MUST use this hook rather than calling useSWR("/api/nepse/live")
 * directly: SWR keys are global, so two hooks on the same key with different
 * refreshIntervals fight each other and the slower one effectively wins — that
 * was making the board look frozen.
 */
const LIVE_KEY = "/api/nepse/live"

export type Tick = 1 | -1

export type LiveMarketState = {
  rows: LiveMarketRow[] | undefined
  /** securityId -> direction of the most recent LTP change. */
  ticks: Map<string, Tick>
  /** Wall-clock ms of the last poll that actually produced changed data. */
  changedAt: number | null
  /** NEPSE's own newest lastUpdatedDateTime across all rows, "HH:MM:SS" NPT. */
  feedTime: string | null
  /**
   * Epoch ms of that stamp. Lets the UI report how old the data genuinely is
   * rather than how recently we happened to poll — a once-a-minute snapshot
   * must never be presented as a live tick.
   */
  feedStampMs: number | null
  isLoading: boolean
  isValidating: boolean
  error: unknown
  refresh: () => void
}

/** NEPSE returns "2026-08-07 12:48:59.076613" (and sometimes with a T). */
function normalizeFeedTime(value: string): string {
  return value.replace("T", " ")
}

export function useLiveMarket(): LiveMarketState {
  // Tick diffing runs in SWR's onSuccess callback (an external-event handler,
  // not an effect) so setState never cascades a render, and React's dev-mode
  // double-invocation can't clobber the previous-price snapshot.
  const prevPrices = useRef<Map<string, number> | null>(null)
  const [ticks, setTicks] = useState<Map<string, Tick>>(() => new Map())
  const [changedAt, setChangedAt] = useState<number | null>(null)

  // Poll phase lives in a ref, not state: it must be readable by SWR's
  // refreshInterval callback without triggering a re-render on every poll.
  const phase = useRef<FeedPhase>({ stamp: null, arrival: null })

  const { data, error, isLoading, isValidating, mutate } = useSWR<LiveMarketRow[]>(LIVE_KEY, nepseFetcher, {
    ...LIVE_SWR_OPTS,
    /**
     * Phase-lock the poll to NEPSE's once-a-minute cadence instead of grinding
     * at 500ms the whole time. Anchored on when each new snapshot ARRIVED (see
     * lib/feed-clock.ts — NEPSE stamps snapshots ~30s before serving them, so
     * the stamp itself is the wrong thing to predict from). Within a period
     * nothing upstream can change, so we coast; near the predicted arrival we
     * drop to the 500ms floor and catch the new snapshot within ~1s.
     */
    refreshInterval: () => computePollDelay(Date.now(), phase.current, LIVE_REFRESH_MS),
    onSuccess: (rows) => {
      if (!rows) return

      // Re-anchor the poll phase whenever the snapshot's own stamp advances.
      phase.current = observeStamp(phase.current, newestRowStamp(rows), Date.now())

      const prev = prevPrices.current
      const next = new Map<string, number>()
      const changes = new Map<string, Tick>()

      for (const row of rows) {
        next.set(row.securityId, row.lastTradedPrice)
        const before = prev?.get(row.securityId)
        if (before !== undefined && before !== row.lastTradedPrice) {
          changes.set(row.securityId, row.lastTradedPrice > before ? 1 : -1)
        }
      }

      prevPrices.current = next

      // First payload establishes the baseline — nothing to flash yet.
      if (!prev) return

      if (changes.size > 0) {
        setTicks(changes)
        setChangedAt(Date.now())
      }
    },
  })

  // Clear flashes after the CSS animation finishes so stale highlights don't
  // linger on rows that stopped trading. Must stay under the 1s poll interval,
  // otherwise a busy board keeps resetting this timer and old highlights never
  // clear — making it impossible to tell which rows just ticked.
  useEffect(() => {
    if (ticks.size === 0) return
    const timer = setTimeout(() => setTicks(new Map()), 900)
    return () => clearTimeout(timer)
  }, [ticks])

  const rawFeedStamp = data ? newestRowStamp(data) : null
  const feedStampMs = parseFeedStamp(rawFeedStamp)
  const feedTime = rawFeedStamp ? normalizeFeedTime(rawFeedStamp).split(".")[0].split(" ")[1] : null

  return {
    rows: data,
    ticks,
    changedAt,
    feedTime,
    feedStampMs,
    isLoading,
    isValidating,
    error,
    refresh: () => {
      void mutate()
    },
  }
}

/** Seconds-since-timestamp counter that re-renders once per second. */
export function useSecondsSince(timestamp: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  if (timestamp === null) return null
  return Math.max(0, Math.round((now - timestamp) / 1000))
}
