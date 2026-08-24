import { NextResponse } from "next/server"
import { fetchTopList, fetchTopListForIndex, isTopType, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const type = params.get("type") ?? ""
  const indexIdParam = params.get("indexId")

  if (!isTopType(type)) {
    return NextResponse.json(
      { error: { message: "type must be one of: gainer, loser, turnover, trade, transaction", code: "BAD_REQUEST" } },
      { status: 400 },
    )
  }

  const indexId = indexIdParam !== null ? Number(indexIdParam) : null
  if (indexIdParam !== null && (!Number.isInteger(indexId) || indexId! < 0)) {
    return NextResponse.json(
      { error: { message: "indexId must be a non-negative integer", code: "BAD_REQUEST" } },
      { status: 400 },
    )
  }

  try {
    const data = indexId !== null ? await fetchTopListForIndex(type, indexId) : await fetchTopList(type, true)
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
