import { NextResponse } from "next/server"
import { fetchSecurities, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const securities = await fetchSecurities()

    // Optional ?q= filter on symbol or name (case-insensitive)
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim().toLowerCase()

    const filtered = q
      ? securities.filter(
          (s) => s.symbol.toLowerCase().includes(q) || s.securityName.toLowerCase().includes(q),
        )
      : securities

    return NextResponse.json(
      { data: filtered, total: filtered.length },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
