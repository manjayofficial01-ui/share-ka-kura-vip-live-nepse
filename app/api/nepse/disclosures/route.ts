import { NextResponse } from "next/server"
import { fetchDisclosures, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await fetchDisclosures()
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
