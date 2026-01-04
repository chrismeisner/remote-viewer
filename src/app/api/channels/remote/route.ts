import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { Client } from "basic-ftp";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import type { ChannelInfo } from "@/lib/media";

type ChannelsPayload = {
  channels: ChannelInfo[];
};

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

export const runtime = "nodejs";

// Helper to normalize legacy string[] to ChannelInfo[]
function normalizeChannels(channels: unknown): ChannelInfo[] {
  if (!Array.isArray(channels)) return [];
  return channels.map((ch) => {
    if (typeof ch === "string") {
      return { id: ch };
    }
    if (ch && typeof ch === "object" && typeof (ch as ChannelInfo).id === "string") {
      return ch as ChannelInfo;
    }
    return null;
  }).filter(Boolean) as ChannelInfo[];
}

// Get remote channels
export async function GET() {
  const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
  if (!base) {
    return NextResponse.json({ channels: [] });
  }

  try {
    const channelsUrl = new URL("channels.json", base).toString();
    const res = await fetch(channelsUrl, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ channels: [] });
    }
    const data = await res.json();
    const channels = normalizeChannels(data?.channels);
    return NextResponse.json({ channels });
  } catch {
    return NextResponse.json({ channels: [] });
  }
}

// Add a channel to remote
export async function POST(request: NextRequest) {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    return NextResponse.json(
      { error: "FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH." },
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName.trim() : undefined;
    if (!name) {
      return NextResponse.json({ error: "Channel name is required" }, { status: 400 });
    }

    // Normalize channel name
    const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!normalized) {
      return NextResponse.json({ error: "Invalid channel name" }, { status: 400 });
    }

    // Fetch current channels from remote
    const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
    let currentChannels: ChannelInfo[] = [];
    if (base) {
      try {
        const res = await fetch(new URL("channels.json", base).toString(), { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          currentChannels = normalizeChannels(data?.channels);
        }
      } catch {
        // Start with empty list
      }
    }

    // Check if channel already exists
    if (currentChannels.some((c) => c.id === normalized)) {
      return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
    }

    // Add new channel and sort
    const newChannel: ChannelInfo = { id: normalized, shortName: shortName || undefined };
    const newChannels = [...currentChannels, newChannel].sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { sensitivity: "base" }),
    );

    // Push updated channels.json to remote
    const payload: ChannelsPayload = { channels: newChannels };
    const jsonBody = JSON.stringify(payload, null, 2);
    const baseDir = path.posix.dirname(remotePath);
    const targetPath = path.posix.join(baseDir, "channels.json");

    const client = new Client(15000);
    try {
      await client.access({ host, port, user, password, secure });
      if (baseDir && baseDir !== ".") {
        await client.ensureDir(baseDir);
      }
      const stream = Readable.from([jsonBody]);
      await client.uploadFrom(stream, targetPath);
    } finally {
      client.close();
    }

    // Also update the schedule.json to add empty schedule for the new channel
    const scheduleClient = new Client(15000);
    try {
      await scheduleClient.access({ host, port, user, password, secure });
      const schedulePath = path.posix.join(baseDir, "schedule.json");
      
      // Fetch existing schedule
      let currentSchedule: { channels: Record<string, { slots: unknown[]; shortName?: string }> } = { channels: {} };
      if (base) {
        try {
          const res = await fetch(new URL("schedule.json", base).toString(), { cache: "no-store" });
          if (res.ok) {
            currentSchedule = await res.json();
          }
        } catch {
          // Start with empty schedule
        }
      }
      
      // Add empty schedule for new channel
      if (!currentSchedule.channels) {
        currentSchedule.channels = {};
      }
      currentSchedule.channels[normalized] = { slots: [], shortName: shortName || undefined };
      
      const scheduleBody = JSON.stringify(currentSchedule, null, 2);
      const scheduleStream = Readable.from([scheduleBody]);
      await scheduleClient.uploadFrom(scheduleStream, schedulePath);
    } finally {
      scheduleClient.close();
    }

    return NextResponse.json({ channel: normalized, shortName: shortName || undefined, channels: newChannels });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to create channel: ${msg}` }, { status: 500 });
  }
}

// Update a channel on remote (shortName)
export async function PATCH(request: NextRequest) {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    return NextResponse.json(
      { error: "FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH." },
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const channelId = typeof body?.channel === "string" ? body.channel.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName.trim() : undefined;
    
    if (!channelId) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
    
    // Fetch current channels from remote
    let currentChannels: ChannelInfo[] = [];
    if (base) {
      try {
        const res = await fetch(new URL("channels.json", base).toString(), { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          currentChannels = normalizeChannels(data?.channels);
        }
      } catch {
        // Start with empty list
      }
    }

    // Find and update the channel
    const channelIndex = currentChannels.findIndex((c) => c.id === channelId);
    if (channelIndex === -1) {
      return NextResponse.json({ error: `Channel "${channelId}" not found` }, { status: 404 });
    }

    // Update shortName
    currentChannels[channelIndex] = {
      ...currentChannels[channelIndex],
      shortName: shortName || undefined,
    };

    // Push updated channels.json to remote
    const payload: ChannelsPayload = { channels: currentChannels };
    const jsonBody = JSON.stringify(payload, null, 2);
    const baseDir = path.posix.dirname(remotePath);
    const targetPath = path.posix.join(baseDir, "channels.json");

    const client = new Client(15000);
    try {
      await client.access({ host, port, user, password, secure });
      if (baseDir && baseDir !== ".") {
        await client.ensureDir(baseDir);
      }
      const stream = Readable.from([jsonBody]);
      await client.uploadFrom(stream, targetPath);
    } finally {
      client.close();
    }

    // Also update the schedule.json with the new shortName
    const scheduleClient = new Client(15000);
    try {
      await scheduleClient.access({ host, port, user, password, secure });
      const schedulePath = path.posix.join(baseDir, "schedule.json");
      
      // Fetch existing schedule
      let currentSchedule: { channels: Record<string, { slots?: unknown[]; shortName?: string }> } = { channels: {} };
      if (base) {
        try {
          const res = await fetch(new URL("schedule.json", base).toString(), { cache: "no-store" });
          if (res.ok) {
            currentSchedule = await res.json();
          }
        } catch {
          // Continue with empty schedule
        }
      }
      
      // Update shortName in schedule
      if (currentSchedule.channels && currentSchedule.channels[channelId]) {
        currentSchedule.channels[channelId].shortName = shortName || undefined;
        
        const scheduleBody = JSON.stringify(currentSchedule, null, 2);
        const scheduleStream = Readable.from([scheduleBody]);
        await scheduleClient.uploadFrom(scheduleStream, schedulePath);
      }
    } finally {
      scheduleClient.close();
    }

    return NextResponse.json({ id: channelId, shortName: shortName || undefined });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to update channel: ${msg}` }, { status: 500 });
  }
}

// Delete a channel from remote
export async function DELETE(request: NextRequest) {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    return NextResponse.json(
      { error: "FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH." },
      { status: 400 },
    );
  }

  const channel = request.nextUrl.searchParams.get("channel");
  if (!channel) {
    return NextResponse.json({ error: "Channel name is required" }, { status: 400 });
  }

  try {
    // Fetch current channels from remote
    const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
    let currentChannels: ChannelInfo[] = [];
    if (base) {
      try {
        const res = await fetch(new URL("channels.json", base).toString(), { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          currentChannels = normalizeChannels(data?.channels);
        }
      } catch {
        // Continue with empty list
      }
    }

    // Remove the channel
    const newChannels = currentChannels.filter((c) => c.id !== channel);

    // Push updated channels.json to remote
    const payload: ChannelsPayload = { channels: newChannels };
    const jsonBody = JSON.stringify(payload, null, 2);
    const baseDir = path.posix.dirname(remotePath);
    const targetPath = path.posix.join(baseDir, "channels.json");

    const client = new Client(15000);
    try {
      await client.access({ host, port, user, password, secure });
      if (baseDir && baseDir !== ".") {
        await client.ensureDir(baseDir);
      }
      const stream = Readable.from([jsonBody]);
      await client.uploadFrom(stream, targetPath);
    } finally {
      client.close();
    }

    // Also update the schedule.json to remove the channel's schedule
    try {
      const scheduleClient = new Client(15000);
      await scheduleClient.access({ host, port, user, password, secure });
      const schedulePath = path.posix.join(baseDir, "schedule.json");
      
      // Fetch existing schedule
      let currentSchedule: { channels: Record<string, unknown> } = { channels: {} };
      if (base) {
        try {
          const res = await fetch(new URL("schedule.json", base).toString(), { cache: "no-store" });
          if (res.ok) {
            currentSchedule = await res.json();
          }
        } catch {
          // Continue with empty schedule
        }
      }
      
      // Remove the channel from schedule
      if (currentSchedule.channels && currentSchedule.channels[channel]) {
        delete currentSchedule.channels[channel];
        
        const scheduleBody = JSON.stringify(currentSchedule, null, 2);
        const scheduleStream = Readable.from([scheduleBody]);
        await scheduleClient.uploadFrom(scheduleStream, schedulePath);
      }
      
      scheduleClient.close();
    } catch {
      // Ignore - schedule file might not exist
    }

    return NextResponse.json({ ok: true, channels: newChannels });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to delete channel: ${msg}` }, { status: 500 });
  }
}

