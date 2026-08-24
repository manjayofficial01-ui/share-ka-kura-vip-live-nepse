import { NextResponse } from "next/server"
import { fetchIndexGraph, fetchIntradayVolume, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

/**
 * Intraday graphs for the NEPSE (58) and Sensitive (57) indices, plus a
 * per-minute volume series derived from the market summary's cumulative
 * traded-shares counter (NEPSE publishes no official volume graph).
 */
export async function GET() {
  try {
    const [nepse, sensitive, volume] = await Promise.all([
      fetchIndexGraph(58),
      fetchIndexGraph(57).catch(() => [] as [number, number][]),
      fetchIntradayVolume().catch(() => [] as [number, number][]),
    ])
    return NextResponse.json(
      { data: { nepse, sensitive, volume } },
      // NEPSE appends one graph point per minute, so this is deliberately not
      // on the 2s real-time budget — a 15s edge cache costs nothing visible.
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
