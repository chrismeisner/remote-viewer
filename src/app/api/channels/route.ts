import { NextRequest, NextResponse } from "next/server";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  renameChannel,
  loadFullSchedule,
  type ChannelInfo,
} from "@/lib/media";
import { normalizeChannelId, isFtpConfigured, uploadJsonToFtp } from "@/lib/ftp";

export const runtime = "nodejs";

type ScheduleData = {
  channels: Record<string, { slots?: unknown[]; shortName?: string; active?: boolean }>;
};

// ==================== REMOTE HELPERS ====================

async function fetchRemoteSchedule(): Promise<ScheduleData | null> {
  try {
    // Add timestamp to bust CDN caches
    const url = `${REMOTE_MEDIA_BASE}schedule.json?t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function listRemoteChannels(): Promise<ChannelInfo[]> {
  const schedule = await fetchRemoteSchedule();
  return channelsFromSchedule(schedule);
}

// Convert schedule object to channels list (used for both fetched and in-memory schedules)
function channelsFromSchedule(schedule: ScheduleData | null): ChannelInfo[] {
  if (!schedule?.channels) return [];
  
  return Object.entries(schedule.channels)
    .map(([id, ch]) => ({
      id,
      shortName: ch.shortName,
      active: ch.active ?? true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: "base" }));
}

async function pushRemoteSchedule(schedule: ScheduleData): Promise<void> {
  if (!isFtpConfigured()) {
    throw new Error("FTP not configured");
  }
  await uploadJsonToFtp("schedule.json", schedule);
}

// ==================== GET ====================
export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source") || "local";
  const isRemote = source === "remote";

  console.log("[Channels API GET] Request received", { source, isRemote });

  try {
    // For local source, always clear the schedule cache to ensure fresh reads
    // This prevents "ghost channels" from appearing after reset operations
    if (!isRemote) {
      console.log("[Channels API GET] Clearing media caches for local source");
      const { clearMediaCaches } = await import("@/lib/media");
      clearMediaCaches();
    }
    
    console.log("[Channels API GET] Calling listChannels...");
    const channels = isRemote 
      ? await listRemoteChannels() 
      : await listChannels("local");
    
    console.log("[Channels API GET] Channels loaded:", {
      count: channels.length,
      channelIds: channels.map(c => c.id),
    });
    
    return NextResponse.json({ channels, source });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list channels";
    console.error("[Channels API GET] Error:", message, error);
    return NextResponse.json({ error: message, channels: [] }, { status: 500 });
  }
}

// ==================== POST (Create) ====================
export async function POST(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source") || "local";
  const isRemote = source === "remote";

  console.log("[Channels API POST] Request received", { source, isRemote });

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName.trim() : undefined;

    console.log("[Channels API POST] Parsed body:", { id, shortName, rawBody: body });

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    const normalizedId = normalizeChannelId(id);
    if (!normalizedId) {
      return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
    }

    if (isRemote) {
      if (!isFtpConfigured()) {
        return NextResponse.json({ error: "FTP not configured" }, { status: 400 });
      }

      const schedule = await fetchRemoteSchedule() || { channels: {} };
      
      if (schedule.channels[normalizedId]) {
        return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
      }

      schedule.channels[normalizedId] = {
        slots: [],
        shortName: shortName || undefined,
        active: true,
      };

      await pushRemoteSchedule(schedule);
      // Use in-memory schedule data (don't refetch - CDN might have propagation delay)
      const channels = channelsFromSchedule(schedule);

      return NextResponse.json({
        channel: { id: normalizedId, shortName, active: true },
        channels,
        source,
      });
    } else {
      // Local mode
      const existingChannels = await listChannels("local");
      if (existingChannels.some((ch) => ch.id === normalizedId)) {
        return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
      }

      const result = await createChannel(normalizedId, shortName);
      const channels = await listChannels("local");

      return NextResponse.json({
        channel: { id: result.channel, shortName: result.shortName, active: true },
        channels,
        source,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// ==================== PATCH (Update) ====================
export async function PATCH(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source") || "local";
  const isRemote = source === "remote";

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const newIdRaw = typeof body?.newId === "string" ? body.newId.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName : undefined;
    const active = typeof body?.active === "boolean" ? body.active : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    if (isRemote) {
      if (!isFtpConfigured()) {
        return NextResponse.json({ error: "FTP not configured" }, { status: 400 });
      }

      const schedule = await fetchRemoteSchedule();
      if (!schedule?.channels[id]) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }

      let targetId = id;

      // Handle rename
      if (newIdRaw) {
        const normalizedNewId = normalizeChannelId(newIdRaw);
        if (normalizedNewId && normalizedNewId !== id) {
          if (schedule.channels[normalizedNewId]) {
            return NextResponse.json({ error: "Channel ID already exists" }, { status: 400 });
          }
          schedule.channels[normalizedNewId] = schedule.channels[id];
          delete schedule.channels[id];
          targetId = normalizedNewId;
        }
      }

      // Update properties
      if (shortName !== undefined) schedule.channels[targetId].shortName = shortName || undefined;
      if (active !== undefined) schedule.channels[targetId].active = active;

      await pushRemoteSchedule(schedule);
      // Use in-memory schedule data (don't refetch - CDN might have propagation delay)
      const channels = channelsFromSchedule(schedule);
      const updated = channels.find(c => c.id === targetId);

      return NextResponse.json({
        channel: updated || { id: targetId, active: true },
        channels,
        source,
      });
    } else {
      // Local mode
      let targetId = id;

      if (newIdRaw) {
        const normalizedNewId = normalizeChannelId(newIdRaw);
        if (normalizedNewId && normalizedNewId !== id) {
          const existingChannels = await listChannels("local");
          if (existingChannels.some((ch) => ch.id === normalizedNewId)) {
            return NextResponse.json({ error: "Channel ID already exists" }, { status: 400 });
          }
          await renameChannel(id, normalizedNewId);
          targetId = normalizedNewId;
        }
      }

      const updates: { shortName?: string; active?: boolean } = {};
      if (shortName !== undefined) updates.shortName = shortName;
      if (active !== undefined) updates.active = active;

      let updatedChannel: ChannelInfo;
      if (Object.keys(updates).length > 0) {
        updatedChannel = await updateChannel(targetId, updates);
      } else {
        const channels = await listChannels("local");
        updatedChannel = channels.find((ch) => ch.id === targetId) || { id: targetId, active: true };
      }

      const channels = await listChannels("local");
      return NextResponse.json({ channel: updatedChannel, channels, source });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update channel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// ==================== DELETE ====================
export async function DELETE(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source") || "local";
  const isRemote = source === "remote";
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
  }

  try {
    if (isRemote) {
      if (!isFtpConfigured()) {
        return NextResponse.json({ error: "FTP not configured" }, { status: 400 });
      }

      const schedule = await fetchRemoteSchedule();
      if (!schedule?.channels[id]) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }

      delete schedule.channels[id];
      await pushRemoteSchedule(schedule);
      // Use in-memory schedule data (don't refetch - CDN might have propagation delay)
      const channels = channelsFromSchedule(schedule);

      return NextResponse.json({ ok: true, channels, source });
    } else {
      // Local mode
      const existingChannels = await listChannels("local");
      if (!existingChannels.some((ch) => ch.id === id)) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }

      await deleteChannel(id);
      const channels = await listChannels("local");

      return NextResponse.json({ ok: true, channels, source });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
