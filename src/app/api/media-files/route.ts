import { NextRequest, NextResponse } from "next/server";
import { getScheduleItems } from "@/lib/media";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const refresh =
      request.nextUrl.searchParams.get("refresh") === "1" ||
      request.nextUrl.searchParams.get("refresh") === "true";

    const items = await getScheduleItems({ refresh });

    return NextResponse.json({ items });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list media files";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function normalizeRel(rel: string): string {
  const safe = rel.replace(/^(\.\.(\/|\\|$))+/, "");
  return path.normalize(safe).replace(/\\/g, "/");
}


