import { NextResponse } from "next/server";
import { REMOTE_MEDIA_BASE } from "@/constants/media";

export const runtime = "nodejs";

/**
 * GET /api/tvos/config
 * Lightweight config endpoint for the tvOS client.
 * Returns the CDN base URL so AVPlayer can stream directly without going
 * through the Next.js media proxy.
 */
export async function GET() {
  const mediaBase = (process.env.REMOTE_MEDIA_BASE ?? REMOTE_MEDIA_BASE).replace(/\/?$/, "/");
  return NextResponse.json({ mediaBase });
}
