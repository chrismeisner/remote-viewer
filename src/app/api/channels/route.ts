import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import { getLocalChannelsFilePath, getLocalScheduleFilePath } from "@/lib/media";
import type { Schedule } from "@/lib/schedule";

export const runtime = "nodejs";

type Channel = {
  id: string;
  shortName?: string;
};

type ChannelsData = {
  channels: Channel[];
};

function normalizeChannelId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

// Read local channels from file
async function readLocalChannels(): Promise<Channel[]> {
  const channelsFile = await getLocalChannelsFilePath();
  try {
    const raw = await fs.readFile(channelsFile, "utf8");
    const data: ChannelsData = JSON.parse(raw);
    return Array.isArray(data.channels) ? data.channels : [];
  } catch {
    return [];
  }
}

// Write local channels to file
async function writeLocalChannels(channels: Channel[]): Promise<void> {
  const channelsFile = await getLocalChannelsFilePath();
  await fs.mkdir(path.dirname(channelsFile), { recursive: true });
  const data: ChannelsData = { channels };
  await fs.writeFile(channelsFile, JSON.stringify(data, null, 2), "utf8");
}

async function loadLocalSchedule(): Promise<Schedule> {
  const scheduleFile = await getLocalScheduleFilePath();
  try {
    const raw = await fs.readFile(scheduleFile, "utf8");
    const parsed = JSON.parse(raw) as Schedule;
    if (!parsed.channels || typeof parsed.channels !== "object") {
      return { channels: {} };
    }
    return parsed;
  } catch {
    return { channels: {} };
  }
}

async function updateScheduleForChannelChange(
  oldId: string,
  newId: string,
  shortName?: string,
): Promise<void> {
  const scheduleFile = await getLocalScheduleFilePath();
  const schedule = await loadLocalSchedule();
  const trimmedShortName = typeof shortName === "string" ? shortName.trim() : undefined;
  const targetId = newId || oldId;
  if (!targetId) return;

  const existing = schedule.channels?.[oldId];
  const targetExisting = schedule.channels?.[targetId];
  const nextChannels = { ...(schedule.channels || {}) };

  if (existing) {
    const updated = { ...existing };
    if (trimmedShortName !== undefined) {
      updated.shortName = trimmedShortName || undefined;
    }
    delete nextChannels[oldId];
    nextChannels[targetId] = updated;
  } else if (targetExisting && trimmedShortName !== undefined) {
    nextChannels[targetId] = { ...targetExisting, shortName: trimmedShortName || undefined };
  }

  await fs.mkdir(path.dirname(scheduleFile), { recursive: true });
  await fs.writeFile(
    scheduleFile,
    JSON.stringify({ ...schedule, channels: nextChannels }, null, 2),
    "utf8",
  );
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
    const normalizedId = normalizeChannelId(id);
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
    const newIdRaw = typeof body?.newId === "string" ? body.newId.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    const channels = await readLocalChannels();
    const index = channels.findIndex((ch) => ch.id === id);

    if (index === -1) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Handle ID change
    const normalizedNewId = newIdRaw ? normalizeChannelId(newIdRaw) : "";
    const targetId = normalizedNewId || id;
    if (normalizedNewId && normalizedNewId !== id) {
      if (channels.some((ch) => ch.id === normalizedNewId)) {
        return NextResponse.json({ error: "Channel ID already exists" }, { status: 400 });
      }
      channels[index].id = normalizedNewId;
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

    // Re-sort if ID changed
    channels.sort((a, b) => {
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.id.localeCompare(b.id);
    });

    await writeLocalChannels(channels);
    try {
      await updateScheduleForChannelChange(id, targetId, shortName);
    } catch (scheduleErr) {
      console.warn("Failed to update schedule for channel change:", scheduleErr);
    }

    const updatedChannel = channels.find((ch) => ch.id === targetId) ?? channels[index];
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
    const scheduleFile = await getLocalScheduleFilePath();
    const channels = await readLocalChannels();
    const filtered = channels.filter((ch) => ch.id !== id);

    if (filtered.length === channels.length) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Delete the channel from channels.json
    await writeLocalChannels(filtered);

    // Also delete the channel's schedule from schedule.json
    try {
      const scheduleRaw = await fs.readFile(scheduleFile, "utf8");
      const scheduleData = JSON.parse(scheduleRaw);
      
      // The schedule file has structure: { channels: { [channelId]: { slots: [...] } } }
      if (scheduleData && scheduleData.channels && typeof scheduleData.channels === "object") {
        if (scheduleData.channels[id]) {
          delete scheduleData.channels[id];
          await fs.writeFile(scheduleFile, JSON.stringify(scheduleData, null, 2), "utf8");
          console.log(`Deleted schedule for channel ${id}`);
        }
      }
    } catch (scheduleErr) {
      // If schedule deletion fails, log but don't fail the whole operation
      console.warn(`Failed to delete schedule for channel ${id}:`, scheduleErr);
    }

    return NextResponse.json({ ok: true, channels: filtered, deletedSchedule: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
