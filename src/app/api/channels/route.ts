import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { REMOTE_MEDIA_BASE } from "@/constants/media";

export const runtime = "nodejs";

type Channel = {
  id: string;
  shortName?: string;
};

type ChannelsData = {
  channels: Channel[];
};

const CHANNELS_FILE = path.join(process.cwd(), "data", "channels.json");

// Read local channels from file
async function readLocalChannels(): Promise<Channel[]> {
  try {
    const raw = await fs.readFile(CHANNELS_FILE, "utf8");
    const data: ChannelsData = JSON.parse(raw);
    return Array.isArray(data.channels) ? data.channels : [];
  } catch {
    return [];
  }
}

// Write local channels to file
async function writeLocalChannels(channels: Channel[]): Promise<void> {
  await fs.mkdir(path.dirname(CHANNELS_FILE), { recursive: true });
  const data: ChannelsData = { channels };
  await fs.writeFile(CHANNELS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Read remote channels from CDN
async function readRemoteChannels(): Promise<Channel[]> {
  const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
  if (!base) return [];

  try {
    const url = new URL("channels.json", base).toString();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data: ChannelsData = await res.json();
    return Array.isArray(data.channels) ? data.channels : [];
  } catch {
    return [];
  }
}

// GET - List all channels
export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source");
  const isRemote = source === "remote";

  try {
    const channels = isRemote ? await readRemoteChannels() : await readLocalChannels();
    return NextResponse.json({ channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list channels";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST - Create a new channel
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName.trim() : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    // Normalize ID (allow numbers and alphanumeric)
    const normalizedId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!normalizedId) {
      return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
    }

    const channels = await readLocalChannels();

    // Check for duplicate
    if (channels.some((ch) => ch.id === normalizedId)) {
      return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
    }

    // Add and sort
    const newChannel: Channel = { id: normalizedId };
    if (shortName) newChannel.shortName = shortName;
    
    channels.push(newChannel);
    channels.sort((a, b) => {
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.id.localeCompare(b.id);
    });

    await writeLocalChannels(channels);
    return NextResponse.json({ channel: newChannel, channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// PATCH - Update a channel (shortName)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    const channels = await readLocalChannels();
    const index = channels.findIndex((ch) => ch.id === id);

    if (index === -1) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Update shortName
    if (shortName !== undefined) {
      const trimmed = shortName.trim();
      if (trimmed) {
        channels[index].shortName = trimmed;
      } else {
        delete channels[index].shortName;
      }
    }

    await writeLocalChannels(channels);
    return NextResponse.json({ channel: channels[index], channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update channel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE - Delete a channel
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
  }

  try {
    const channels = await readLocalChannels();
    const filtered = channels.filter((ch) => ch.id !== id);

    if (filtered.length === channels.length) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    await writeLocalChannels(filtered);
    return NextResponse.json({ ok: true, channels: filtered });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
