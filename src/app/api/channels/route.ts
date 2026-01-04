import { NextRequest, NextResponse } from "next/server";
import { createChannel, deleteChannel, listChannels, updateChannel } from "@/lib/media";
import type { MediaSource } from "@/constants/media";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source: MediaSource =
    sourceParam === "remote" || sourceParam === "local" ? sourceParam : "local";

  try {
    const channels = await listChannels(source);
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
    const shortName: string | undefined =
      typeof body?.shortName === "string" ? body.shortName : undefined;
    const { channel, schedule, shortName: returnedShortName } = await createChannel(name, shortName);
    return NextResponse.json({ channel, schedule, shortName: returnedShortName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const channel: string | undefined =
      typeof body?.channel === "string" ? body.channel : undefined;
    if (!channel) {
      return NextResponse.json({ error: "channel is required" }, { status: 400 });
    }
    const shortName: string | undefined =
      typeof body?.shortName === "string" ? body.shortName : undefined;
    const updated = await updateChannel(channel, { shortName });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update channel";
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

