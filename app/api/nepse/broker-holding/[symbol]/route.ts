import { NextResponse } from "next/server"
import { fetchBrokerHolding, type BrokerHoldingPeriod } from "@/lib/broker-holding"

export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const clean = decodeURIComponent(symbol).trim().toUpperCase()
  if (!/^[A-Z0-9]{1,12}$/.test(clean)) {
    return NextResponse.json({ error: { message: "Invalid symbol", code: "BAD_REQUEST" } }, { status: 400 })
  }

  const periodParam = new URL(req.url).searchParams.get("period")
  const period: BrokerHoldingPeriod = periodParam === "monthly" ? "monthly" : "weekly"

  try {
    const data = await fetchBrokerHolding(clean, period)
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load broker holding data"
    return NextResponse.json({ error: { message, code: "UPSTREAM_ERROR" } }, { status: 502 })
  }
}
