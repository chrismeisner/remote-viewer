import { NextRequest, NextResponse } from "next/server";
import { getNowPlaying } from "@/lib/media";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  try {
    const nowPlaying = await getNowPlaying(undefined, channel);
    const serverTimeMs = Date.now();
    console.log("[now-playing] resolved", {
      channel: channel ?? "default",
      title: nowPlaying?.title,
      relPath: nowPlaying?.relPath,
      durationSeconds: nowPlaying?.durationSeconds,
      startOffsetSeconds: nowPlaying?.startOffsetSeconds,
      endsAt: nowPlaying?.endsAt,
      serverTimeMs,
    });
    return NextResponse.json({ ...nowPlaying, serverTimeMs });
  } catch (error) {
    try {
      // Extra diagnostics when schedule resolution fails.
      const schedule = await loadSchedule(channel);
      console.warn("[now-playing] failed", {
        channel: channel ?? "default",
        error: error instanceof Error ? error.message : String(error),
        serverTimeMs: Date.now(),
        slots: Array.isArray(schedule?.slots) ? schedule?.slots.length : 0,
        sampleSlot: Array.isArray(schedule?.slots) ? schedule?.slots[0] : null,
      });
    } catch {
      // ignore secondary failures
    }
    const message =
      error instanceof Error ? error.message : "Failed to resolve schedule";
    const status = message.toLowerCase().includes("schedule") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

