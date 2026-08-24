import { NextResponse } from "next/server"
import { fetchSecurityGraph, toErrorResponse } from "@/lib/nepse"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const securityId = Number(id)
  if (!Number.isInteger(securityId) || securityId <= 0) {
    return NextResponse.json({ error: { message: "Invalid security id", code: "BAD_REQUEST" } }, { status: 400 })
  }
  try {
    const data = await fetchSecurityGraph(securityId)
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    )
  } catch (err) {
    const { message, code, status } = toErrorResponse(err)
    return NextResponse.json({ error: { message, code } }, { status })
  }
}
