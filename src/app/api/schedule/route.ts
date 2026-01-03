import { NextRequest, NextResponse } from "next/server";
import { loadSchedule, saveSchedule } from "@/lib/media";
import { DailySchedule } from "@/lib/schedule";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  const schedule = await loadSchedule(channel);
  return NextResponse.json({ schedule });
}

export async function PUT(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  try {
    const payload = (await request.json()) as DailySchedule;
    const saved = await saveSchedule(payload, channel);
    return NextResponse.json({ schedule: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save schedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


