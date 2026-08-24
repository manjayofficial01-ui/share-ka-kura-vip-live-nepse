import { NextResponse } from "next/server"
import { fetchMarketSummary, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await fetchMarketSummary()
    return NextResponse.json(
      { data },
      // Real-time feed: no HTTP caching, or a CDN/browser hit would mask new
      // values well past the 2s budget. The in-memory TTL still shields NEPSE.
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
