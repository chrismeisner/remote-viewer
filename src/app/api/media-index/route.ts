import { NextRequest, NextResponse } from "next/server";
import { REMOTE_MEDIA_BASE } from "@/constants/media";

export const runtime = "nodejs";

function getBase(request: NextRequest): string | null {
  const override = request.nextUrl.searchParams.get("base");
  if (override) return override;
  if (process.env.REMOTE_MEDIA_BASE) return process.env.REMOTE_MEDIA_BASE;
  return REMOTE_MEDIA_BASE || null;
}

export async function GET(request: NextRequest) {
  const base = getBase(request);
  if (!base) {
    return NextResponse.json(
      { error: "REMOTE_MEDIA_BASE is not configured" },
      { status: 400 },
    );
  }

  try {
    const manifestUrl = new URL("media-index.json", base).toString();
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status} for ${manifestUrl}` },
        { status: res.status },
      );
    }
    const json = await res.json();
    return NextResponse.json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to fetch remote manifest: ${message}` },
      { status: 502 },
    );
  }
}


