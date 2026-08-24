import { NextResponse } from "next/server"
import { fetchNepseIndex, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const indexes = await fetchNepseIndex()
    return NextResponse.json(
      { data: indexes },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
