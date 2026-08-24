import { NextResponse } from "next/server"
import { fetchSecurityDetail, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,12}$/

export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params

  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json(
      { error: { message: "Invalid symbol format", code: "INVALID_SYMBOL" } },
      { status: 400 },
    )
  }

  try {
    const detail = await fetchSecurityDetail(symbol)
    return NextResponse.json(
      { data: detail },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
