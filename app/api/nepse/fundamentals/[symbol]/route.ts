import { NextResponse } from "next/server"
import { fetchFundamentals } from "@/lib/chukul"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  if (!symbol || !/^[A-Za-z0-9]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: { message: "Invalid symbol", code: "BAD_REQUEST" } }, { status: 400 })
  }
  try {
    const data = await fetchFundamentals(symbol)
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
    )
  } catch {
    return NextResponse.json(
      { error: { message: "Could not load fundamentals from chukul.com", code: "UPSTREAM_ERROR" } },
      { status: 502 },
    )
  }
}
