import { NextResponse } from "next/server"
import { fetchLivesMarket, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

/**
 * Full live-market rows (same endpoint nepalstock.com/live-market uses),
 * including open/high/low, LTV and average traded price.
 */
export async function GET() {
  try {
    const data = await fetchLivesMarket()
    return NextResponse.json(
      { data, total: data.length },
      // no-store: every poll must reach the server so new LTP ticks are never
      // masked by CDN/browser HTTP caching (the in-memory server cache still
      // protects NEPSE from being hammered).
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
