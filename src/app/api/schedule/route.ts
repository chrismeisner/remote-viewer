import { NextRequest, NextResponse } from "next/server";
import { loadSchedule, saveSchedule } from "@/lib/media";
import { DailySchedule } from "@/lib/schedule";
import type { MediaSource } from "@/constants/media";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source: MediaSource =
    sourceParam === "remote" || sourceParam === "local" ? sourceParam : "local";

  const schedule = await loadSchedule(channel, source);
  return NextResponse.json({ schedule, source });
}

export async function PUT(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  const sourceParam = request.nextUrl.searchParams.get("source");

  // Only allow saving to local source
  if (sourceParam === "remote") {
    return NextResponse.json(
      { error: "Cannot save schedule to remote source. Use local source and push to remote." },
      { status: 400 },
    );
  }

  try {
    const payload = (await request.json()) as DailySchedule;
    const saved = await saveSchedule(payload, channel);
    return NextResponse.json({ schedule: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save schedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


