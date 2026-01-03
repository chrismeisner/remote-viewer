import { NextRequest, NextResponse } from "next/server";
import { DailySchedule, loadSchedule, saveSchedule } from "@/lib/media";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: { channel: string } },
) {
  const channel = params.channel;
  const schedule = await loadSchedule(channel);
  return NextResponse.json({ schedule });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { channel: string } },
) {
  const channel = params.channel;
  try {
    const payload = (await request.json()) as DailySchedule;
    const saved = await saveSchedule(payload, channel);
    return NextResponse.json({ schedule: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save schedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

