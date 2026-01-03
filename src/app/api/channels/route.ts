import { NextRequest, NextResponse } from "next/server";
import { createChannel, deleteChannel, listChannels } from "@/lib/media";
import { DEFAULT_CHANNEL } from "@/constants/channels";

export const runtime = "nodejs";

export async function GET() {
  try {
    const channels = await listChannels();
    return NextResponse.json({ channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list channels";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name: string | undefined =
      typeof body?.name === "string" ? body.name : undefined;
    const { channel, schedule } = await createChannel(name);
    return NextResponse.json({ channel, schedule });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  if (!channel) {
    return NextResponse.json({ error: "channel is required" }, { status: 400 });
  }
  try {
    await deleteChannel(channel);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete channel";
    const status = channel === DEFAULT_CHANNEL ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

