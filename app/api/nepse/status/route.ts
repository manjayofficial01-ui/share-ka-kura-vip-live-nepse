import { NextResponse } from "next/server"
import { fetchMarketStatus, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const status = await fetchMarketStatus()
    return NextResponse.json(
      { data: status },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
