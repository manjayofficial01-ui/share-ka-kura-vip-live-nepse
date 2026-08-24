import { NextResponse } from "next/server"
import { fetchSubIndexes, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await fetchSubIndexes()
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
