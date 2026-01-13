import { NextRequest, NextResponse } from "next/server";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  renameChannel,
} from "@/lib/media";
import { normalizeChannelId } from "@/lib/ftp";

export const runtime = "nodejs";

type Channel = {
  id: string;
  shortName?: string;
  active?: boolean;
};

type ChannelsData = {
  channels: Channel[];
};

// Read remote channels from CDN (still uses channels.json for backwards compatibility)
async function readRemoteChannels(): Promise<Channel[]> {
  const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
  if (!base) return [];

  try {
    // Try schedule.json first (new format)
    const scheduleUrl = new URL("schedule.json", base).toString();
    const scheduleRes = await fetch(scheduleUrl, { cache: "no-store" });
    if (scheduleRes.ok) {
      const scheduleData = await scheduleRes.json();
      if (scheduleData?.channels && typeof scheduleData.channels === "object") {
        return Object.entries(scheduleData.channels).map(([id, ch]) => ({
          id,
          shortName: (ch as { shortName?: string }).shortName,
          active: (ch as { active?: boolean }).active ?? true,
        }));
      }
    }

    // Fallback to channels.json (legacy format)
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
    const channels = isRemote
      ? await readRemoteChannels()
      : await listChannels("local");
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

    const normalizedId = normalizeChannelId(id);
    if (!normalizedId) {
      return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
    }

    // Check if channel already exists
    const existingChannels = await listChannels("local");
    if (existingChannels.some((ch) => ch.id === normalizedId)) {
      return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
    }

    // Create channel in schedule.json
    const result = await createChannel(normalizedId, shortName);
    
    // Get updated channel list
    const channels = await listChannels("local");

    return NextResponse.json({
      channel: {
        id: result.channel,
        shortName: result.shortName,
        active: true,
      },
      channels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// PATCH - Update a channel (shortName, active, or rename)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const newIdRaw = typeof body?.newId === "string" ? body.newId.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName : undefined;
    const active = typeof body?.active === "boolean" ? body.active : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    // Handle ID change (rename)
    let targetId = id;
    if (newIdRaw) {
      const normalizedNewId = normalizeChannelId(newIdRaw);
      if (!normalizedNewId) {
        return NextResponse.json({ error: "Invalid new channel ID" }, { status: 400 });
      }
      if (normalizedNewId !== id) {
        // Check if new ID already exists
        const existingChannels = await listChannels("local");
        if (existingChannels.some((ch) => ch.id === normalizedNewId)) {
          return NextResponse.json({ error: "Channel ID already exists" }, { status: 400 });
        }
        // Rename the channel
        await renameChannel(id, normalizedNewId);
        targetId = normalizedNewId;
      }
    }

    // Update other properties
    const updates: { shortName?: string; active?: boolean } = {};
    if (shortName !== undefined) updates.shortName = shortName;
    if (active !== undefined) updates.active = active;

    let updatedChannel: Channel;
    if (Object.keys(updates).length > 0) {
      const result = await updateChannel(targetId, updates);
      updatedChannel = {
        id: result.id,
        shortName: result.shortName,
        active: result.active,
      };
    } else {
      // Just return the current state if only ID was changed
      const channels = await listChannels("local");
      const found = channels.find((ch) => ch.id === targetId);
      updatedChannel = found || { id: targetId, active: true };
    }

    const channels = await listChannels("local");
    return NextResponse.json({ channel: updatedChannel, channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update channel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE - Delete a channel and its schedule
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
  }

  try {
    // Check if channel exists
    const existingChannels = await listChannels("local");
    if (!existingChannels.some((ch) => ch.id === id)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Delete channel from schedule.json
    await deleteChannel(id);

    const channels = await listChannels("local");
    return NextResponse.json({ ok: true, channels, deletedSchedule: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
