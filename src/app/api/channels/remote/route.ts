import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { Client } from "basic-ftp";
import { REMOTE_MEDIA_BASE } from "@/constants/media";

export const runtime = "nodejs";

type Channel = {
  id: string;
  shortName?: string;
  active?: boolean;
};

type ChannelsData = {
  channels: Channel[];
};

function normalizeChannelId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function getEnv() {
  const host = process.env.FTP_HOST?.trim();
  const user = process.env.FTP_USER?.trim();
  const password = process.env.FTP_PASS?.trim();
  const portRaw = process.env.FTP_PORT?.trim();
  const remotePath = process.env.FTP_REMOTE_PATH?.trim();
  const secureRaw = process.env.FTP_SECURE?.trim()?.toLowerCase();
  const port = portRaw ? Number(portRaw) : 21;
  const secure = secureRaw === "true" || secureRaw === "1";
  return { host, user, password, port, remotePath, secure };
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

// Push channels to remote via FTP
async function pushRemoteChannels(channels: Channel[]): Promise<void> {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    throw new Error("FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH.");
  }

  const data: ChannelsData = { channels };
  const json = JSON.stringify(data, null, 2);
  const baseDir = path.posix.dirname(remotePath);
  const targetPath = path.posix.join(baseDir, "channels.json");

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    if (baseDir && baseDir !== ".") {
      await client.ensureDir(baseDir);
    }
    const stream = Readable.from([json]);
    await client.uploadFrom(stream, targetPath);
  } finally {
    client.close();
  }
}

// GET - List remote channels
export async function GET() {
  try {
    const channels = await readRemoteChannels();
    return NextResponse.json({ channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list channels";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST - Create a new remote channel
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName.trim() : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    const normalizedId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!normalizedId) {
      return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
    }

    const channels = await readRemoteChannels();

    if (channels.some((ch) => ch.id === normalizedId)) {
      return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
    }

    const newChannel: Channel = { id: normalizedId, active: true };
    if (shortName) newChannel.shortName = shortName;

    channels.push(newChannel);
    channels.sort((a, b) => {
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.id.localeCompare(b.id);
    });

    await pushRemoteChannels(channels);
    return NextResponse.json({ channel: newChannel, channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH - Update a remote channel
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

    const channels = await readRemoteChannels();
    const index = channels.findIndex((ch) => ch.id === id);

    if (index === -1) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const normalizedNewId = newIdRaw ? normalizeChannelId(newIdRaw) : "";
    const targetId = normalizedNewId || id;
    if (normalizedNewId && normalizedNewId !== id) {
      if (channels.some((ch) => ch.id === normalizedNewId)) {
        return NextResponse.json({ error: "Channel ID already exists" }, { status: 400 });
      }
      channels[index].id = normalizedNewId;
    }

    if (shortName !== undefined) {
      const trimmed = shortName.trim();
      if (trimmed) {
        channels[index].shortName = trimmed;
      } else {
        delete channels[index].shortName;
      }
    }

    if (active !== undefined) {
      channels[index].active = active;
    }

    channels.sort((a, b) => {
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.id.localeCompare(b.id);
    });

    await pushRemoteChannels(channels);

    // Keep local schedule in sync and push to remote
    if (normalizedNewId || shortName !== undefined) {
      try {
        const { loadFullSchedule, saveFullSchedule } = await import("@/lib/media");
        const schedule = await loadFullSchedule("local");
        const trimmed = typeof shortName === "string" ? shortName.trim() : undefined;
        const existing = schedule.channels?.[id];
        const targetExisting = schedule.channels?.[targetId];

        if (existing) {
          const updated = { ...existing };
          if (trimmed !== undefined) {
            updated.shortName = trimmed || undefined;
          }
          delete schedule.channels[id];
          schedule.channels[targetId] = updated;
        } else if (targetExisting && trimmed !== undefined) {
          schedule.channels[targetId] = { ...targetExisting, shortName: trimmed || undefined };
        }

        await saveFullSchedule(schedule);

        const { pushScheduleToRemote } = await import("./schedule-helper");
        try {
          await pushScheduleToRemote(schedule);
        } catch (pushErr) {
          console.warn("Failed to push remote schedule after channel update:", pushErr);
        }
      } catch (scheduleErr) {
        console.warn("Failed to sync schedule for remote channel update:", scheduleErr);
      }
    }

    const updatedChannel = channels.find((ch) => ch.id === targetId) ?? channels[index];
    return NextResponse.json({ channel: updatedChannel, channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE - Delete a remote channel and its schedule
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
  }

  try {
    // 1. Get current remote channels
    const channels = await readRemoteChannels();
    const filtered = channels.filter((ch) => ch.id !== id);

    if (filtered.length === channels.length) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // 2. Also update schedule.json to remove this channel
    // Load the local schedule (which will be pushed to remote)
    const { loadFullSchedule, saveFullSchedule } = await import("@/lib/media");
    const schedule = await loadFullSchedule("local");
    
    if (schedule.channels && schedule.channels[id]) {
      delete schedule.channels[id];
      await saveFullSchedule(schedule);
      console.log(`Deleted schedule for remote channel ${id}`);
    }

    // 3. Push updated channels.json to remote
    await pushRemoteChannels(filtered);

    // 4. Push updated schedule.json to remote
    const { pushScheduleToRemote } = await import("./schedule-helper");
    try {
      await pushScheduleToRemote(schedule);
    } catch (err) {
      console.warn("Failed to push schedule to remote:", err);
      // Don't fail the whole operation if schedule push fails
    }

    return NextResponse.json({ ok: true, channels: filtered, deletedSchedule: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
