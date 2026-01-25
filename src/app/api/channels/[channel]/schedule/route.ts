import { NextRequest, NextResponse } from "next/server";
import { loadSchedule, saveSchedule } from "@/lib/media";
import { ChannelSchedule } from "@/lib/schedule";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  const schedule = await loadSchedule(channel);
  return NextResponse.json({ schedule });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  try {
    const payload = (await request.json()) as ChannelSchedule;
    const saved = await saveSchedule(payload, channel);
    return NextResponse.json({ schedule: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save schedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

