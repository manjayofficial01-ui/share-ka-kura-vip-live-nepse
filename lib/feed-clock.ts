/**
 * Phase-locked scheduling for NEPSE's minute-published feeds.
 *
 * WHY THIS EXISTS
 * ---------------
 * NEPSE does not publish a tick stream. Its `lives-market` and `nepse-index`
 * endpoints expose a *snapshot* regenerated once per minute, and every timestamp
 * lands on a `:59`/`:00` boundary. Measured live during open market:
 *
 *   lives-market lastUpdatedDateTime: 14:28:59 -> 14:29:59 -> 14:31:00
 *   nepse-index  generatedTime:       14:32:59 -> 14:33:59
 *
 * So ~60s of staleness is upstream and physically unfixable. What IS fixable is
 * the extra lag we were adding: with a flat 1s cache TTL our polls drifted out
 * of phase with upstream's publish, and a 14:33:59 snapshot was still being
 * served at 14:35:13 — 74s stale, a full wasted period.
 *
 * WHY WE LOCK TO ARRIVAL, NOT TO THE TIMESTAMP
 * --------------------------------------------
 * The obvious approach — predict the next publish as `stamp + 60s` — was tried
 * and measured WRONG. NEPSE stamps a snapshot well before it serves it:
 *
 *   snapshot stamped 14:43:59  ->  first fetchable at ~14:44:29   (~30s lag)
 *
 * Aiming the hunt window at `stamp + 60s` therefore points it ~30s too early;
 * the window expired before the data existed and we fell back to a slow poll at
 * exactly the wrong moment. So we phase-lock to the **observed arrival time** of
 * each new snapshot instead: whatever the upstream stamp-to-availability lag is,
 * consecutive arrivals are still one period apart, so
 *
 *   next arrival ≈ last arrival + 60s
 *
 * self-calibrates to any constant lag without having to model it. The stamp is
 * still parsed, but only to detect "this is a new snapshot" and to report the
 * data's true age in the UI.
 *
 * THE THREE REGIMES
 * -----------------
 *   coast   — nothing upstream can change yet: serve cache, zero upstream calls
 *   hunt    — around the predicted arrival: re-check every HUNT_TTL_MS until the
 *             snapshot's own timestamp actually advances
 *   backoff — snapshot long overdue (market closed, halted, holiday): poll
 *             slowly so we don't hammer NEPSE all night
 *
 * Worst-case detection becomes ~HUNT_TTL_MS + one request (~1s) instead of ~75s,
 * while upstream volume DROPS from ~60 calls/min to ~8. Freshness and load both
 * improve, which is why this beats simply shortening the TTL.
 *
 * The phase math is pure — time and state are always arguments — so it can be
 * reasoned about and tested without waiting on a live market.
 */

/** NEPSE regenerates its snapshots once per minute. */
export const PUBLISH_PERIOD_MS = 60_000

/**
 * Start re-checking this far before the predicted arrival. Absorbs jitter in
 * when NEPSE actually serves the new snapshot.
 */
export const HUNT_LEAD_MS = 3_000

/** While hunting, how long a payload may be reused before re-checking. */
export const HUNT_TTL_MS = 400

/** Nothing to phase-lock to yet — behave like the old flat TTL. */
export const IDLE_TTL_MS = 1_000

/**
 * How far past the predicted arrival we keep hunting before concluding the feed
 * is not advancing. Generous, because arrival jitter is real and giving up early
 * is exactly the bug that made a snapshot land 30s late.
 */
export const OVERDUE_GRACE_MS = 45_000

/** First slow-poll interval once the feed is judged idle. */
export const BACKOFF_TTL_MS = 5_000

/**
 * Ceiling for the progressive backoff. Overnight and on holidays the feed is
 * idle for 16+ hours; a flat 5s poll would be ~12k pointless upstream calls, so
 * the interval doubles up to this cap. Even at the cap a resumed market is
 * picked up within 30s, and the client's own faster poll shortens that further.
 */
export const MAX_BACKOFF_TTL_MS = 30_000

/** Never coast longer than this, so a bad prediction can't strand the feed. */
export const MAX_COAST_MS = 30_000

/** Nepal Standard Time is UTC+05:45 with no DST. */
const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000

/**
 * NEPSE stamps are Kathmandu wall-clock with no zone marker, e.g.
 * "2026-08-07 14:33:59.076613" (sometimes ISO-style with a T). Parsing them with
 * `new Date()` would silently read them as UTC or as the server's local zone and
 * put the age math 5h45m out, so the offset is applied explicitly.
 */
export function parseFeedStamp(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(value.trim())
  if (!match) return null

  const [, y, mo, d, h, mi, s, frac] = match
  const ms = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0

  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms)
  return asUtc - NPT_OFFSET_MS
}

/** Phase state for one feed: which snapshot we hold and when it showed up. */
export type FeedPhase = {
  /** The feed's own timestamp for the snapshot currently held. */
  stamp: string | null
  /** Wall-clock ms when that snapshot was FIRST observed — the phase anchor. */
  arrival: number | null
}

export type PhaseDecision = {
  /** Absolute epoch ms at which the cached payload must be re-checked. */
  expiry: number
  /** Which regime produced this expiry — surfaced for logging/diagnostics. */
  phase: "coast" | "hunt" | "backoff" | "idle"
  /** When the next snapshot is predicted to arrive, or null when unknown. */
  predictedArrival: number | null
}

/**
 * Decide how long the held payload may be cached. Driven by `arrival` (when we
 * first saw this snapshot), NOT by its timestamp — see the header note on why.
 */
export function computePhase(now: number, phase: FeedPhase): PhaseDecision {
  const { arrival } = phase

  if (arrival === null) {
    return { expiry: now + IDLE_TTL_MS, phase: "idle", predictedArrival: null }
  }

  const predictedArrival = arrival + PUBLISH_PERIOD_MS
  const huntFrom = predictedArrival - HUNT_LEAD_MS

  // Comfortably inside the current period: nothing can have changed upstream,
  // so serve cache straight through toward the predicted arrival.
  if (now < huntFrom) {
    return {
      expiry: Math.min(huntFrom, now + MAX_COAST_MS),
      phase: "coast",
      predictedArrival,
    }
  }

  // Around the predicted arrival: re-check hard until the stamp actually moves.
  if (now < predictedArrival + OVERDUE_GRACE_MS) {
    return { expiry: now + HUNT_TTL_MS, phase: "hunt", predictedArrival }
  }

  // Long overdue — the feed isn't advancing (closed, halted, holiday). Poll
  // slowly, doubling the further past due we get so an overnight idle feed costs
  // a couple of calls a minute rather than twelve.
  const overdueBy = now - (predictedArrival + OVERDUE_GRACE_MS)
  const doublings = Math.floor(overdueBy / (5 * PUBLISH_PERIOD_MS))
  const backoff = Math.min(BACKOFF_TTL_MS * 2 ** doublings, MAX_BACKOFF_TTL_MS)

  return { expiry: now + backoff, phase: "backoff", predictedArrival }
}

/**
 * Fold a freshly fetched snapshot into the phase state. The arrival anchor only
 * moves when the stamp genuinely changes, which is what keeps the prediction
 * aligned to upstream's cadence rather than to our own polling.
 */
export function observeStamp(prev: FeedPhase, stamp: string | null, now: number): FeedPhase {
  if (stamp === null) return prev
  if (prev.stamp === stamp && prev.arrival !== null) return prev
  return { stamp, arrival: now }
}

/**
 * Client-side counterpart: how long a browser should wait before polling again.
 * Mirrors computePhase but returns a *duration*, and never coasts as long as the
 * server — a browser that oversleeps shows a visibly frozen board, whereas an
 * extra request only ever hits our own warm in-memory cache.
 */
export function computePollDelay(now: number, phase: FeedPhase, minDelayMs: number): number {
  const { expiry, phase: regime } = computePhase(now, phase)
  if (regime === "hunt" || regime === "idle") return minDelayMs
  if (regime === "backoff") return Math.max(minDelayMs, 2_000)
  return Math.max(minDelayMs, Math.min(expiry - now, 10_000))
}

// ---------------------------------------------------------------------------
// Server-side phase registry
//
// Some real-time feeds (market-summary, top-ten, securityDailyTradeStat) carry
// no timestamp of their own, yet are derived from the same once-a-minute
// snapshot. Rather than leaving them on a blind flat TTL, they borrow the phase
// of the stamped feeds so the whole dashboard advances together.
// ---------------------------------------------------------------------------

const EMPTY: FeedPhase = { stamp: null, arrival: null }

/** Key used by feeds that publish no timestamp of their own. */
export const SHARED_PHASE_KEY = "__shared__"

const phases = new Map<string, FeedPhase>()

export function getPhase(key: string): FeedPhase {
  return phases.get(key) ?? phases.get(SHARED_PHASE_KEY) ?? EMPTY
}

/**
 * Record the stamp seen on `key`. Stamped feeds also drive the shared phase so
 * stamp-less feeds can ride the same boundary.
 */
export function recordPhase(key: string, stamp: string | null, now: number): void {
  if (stamp === null) return
  phases.set(key, observeStamp(phases.get(key) ?? EMPTY, stamp, now))
  phases.set(SHARED_PHASE_KEY, observeStamp(phases.get(SHARED_PHASE_KEY) ?? EMPTY, stamp, now))
}

/** Newest `lastUpdatedDateTime` across live-market rows. */
export function newestRowStamp(rows: Array<{ lastUpdatedDateTime?: string | null }>): string | null {
  let newest: string | null = null
  for (const row of rows) {
    const value = row.lastUpdatedDateTime
    if (value && (newest === null || value > newest)) newest = value
  }
  return newest
}
