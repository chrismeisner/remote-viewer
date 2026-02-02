import { NextRequest, NextResponse } from "next/server";
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  renameChannel,
  loadFullSchedule,
  saveFullSchedule,
  type ChannelInfo,
} from "@/lib/media";
import { normalizeChannelId, isFtpConfigured, atomicJsonUpdate, downloadJsonFromFtp, type AtomicUpdateOptions } from "@/lib/ftp";

export const runtime = "nodejs";

type ScheduleData = {
  channels: Record<string, { 
    type?: "24hour" | "looping";
    slots?: unknown[]; 
    playlist?: unknown[];
    shortName?: string; 
    active?: boolean;
  }>;
};

// ==================== REMOTE HELPERS ====================

// NOTE: We read directly from FTP (not CDN) to avoid cache staleness issues.
// CDN caching caused newly created channels to not appear immediately.

async function fetchRemoteScheduleForRead(): Promise<ScheduleData | null> {
  try {
    // Read directly from FTP to avoid CDN cache staleness
    const schedule = await downloadJsonFromFtp<ScheduleData>("schedule.json");
    return schedule;
  } catch (error) {
    console.error("[Channels API] Failed to read schedule from FTP:", error);
    return null;
  }
}

async function listRemoteChannels(): Promise<ChannelInfo[]> {
  if (!isFtpConfigured()) {
    console.warn("[Channels API] FTP not configured for remote channel listing");
    return [];
  }
  const schedule = await fetchRemoteScheduleForRead();
  return channelsFromSchedule(schedule);
}

// Sort channels numerically when IDs are numbers, otherwise alphabetically
function sortChannelsNumerically(channels: ChannelInfo[]): ChannelInfo[] {
  return channels.sort((a, b) => {
    const aNum = parseInt(a.id, 10);
    const bNum = parseInt(b.id, 10);
    // If both are valid numbers, sort numerically
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum;
    }
    // Otherwise fall back to string comparison
    return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
  });
}

// Convert schedule object to channels list (used for both fetched and in-memory schedules)
function channelsFromSchedule(schedule: ScheduleData | null): ChannelInfo[] {
  if (!schedule?.channels) return [];
  
  const channels = Object.entries(schedule.channels)
    .map(([id, ch]) => {
      const scheduleType = ch.type || "24hour";
      const scheduledCount = scheduleType === "looping"
        ? (Array.isArray(ch.playlist) ? ch.playlist.length : 0)
        : (Array.isArray(ch.slots) ? ch.slots.length : 0);
      
      return {
        id,
        shortName: ch.shortName,
        active: ch.active ?? true,
        scheduledCount,
        type: scheduleType as "24hour" | "looping",
      };
    });
  
  return sortChannelsNumerically(channels);
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
    const scheduleType = body?.type === "looping" ? "looping" : "24hour";
    // Default to inactive (false) when creating new channels
    const active = typeof body?.active === "boolean" ? body.active : false;

    console.log("[Channels API POST] Parsed body:", { id, shortName, type: scheduleType, active, rawBody: body });

    if (!id) {
      console.log("[Channels API POST] Error: Channel ID is required");
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    const normalizedId = normalizeChannelId(id);
    console.log("[Channels API POST] Normalized ID:", { original: id, normalized: normalizedId });
    
    if (!normalizedId) {
      console.log("[Channels API POST] Error: Invalid channel ID after normalization");
      return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
    }

    if (isRemote) {
      console.log("[Channels API POST] Remote mode - checking FTP config");
      
      if (!isFtpConfigured()) {
        console.log("[Channels API POST] Error: FTP not configured");
        return NextResponse.json({ error: "FTP not configured" }, { status: 400 });
      }

      console.log("[Channels API POST] FTP configured - starting atomic update");

      // Use atomic operation to prevent race conditions
      // This reads directly from FTP, modifies, and writes back with locking
      // CRITICAL: Use requireExistingOnError to prevent wiping existing channels
      // if there's a transient FTP error during the read phase
      let channelExists = false;
      const safetyOptions: AtomicUpdateOptions = { requireExistingOnError: true };
      const updatedSchedule = await atomicJsonUpdate<ScheduleData>(
        "schedule.json",
        (schedule) => {
          console.log("[Channels API POST] Inside atomic update - current channels:", Object.keys(schedule.channels));
          
          if (schedule.channels[normalizedId]) {
            console.log("[Channels API POST] Channel already exists:", normalizedId);
            channelExists = true;
            return schedule; // No change if channel exists
          }

          console.log("[Channels API POST] Creating new channel:", { normalizedId, scheduleType, shortName, active });
          
          schedule.channels[normalizedId] = scheduleType === "looping"
            ? {
                type: "looping",
                playlist: [],
                shortName: shortName || undefined,
                active,
              }
            : {
                type: "24hour",
                slots: [],
                shortName: shortName || undefined,
                active,
              };
          
          console.log("[Channels API POST] Updated channels:", Object.keys(schedule.channels));
          return schedule;
        },
        { channels: {} },
        safetyOptions
      );

      console.log("[Channels API POST] Atomic update complete", { channelExists, updatedChannels: Object.keys(updatedSchedule.channels) });

      if (channelExists) {
        return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
      }

      // Use the returned schedule data (fresh from FTP, not CDN)
      const channels = channelsFromSchedule(updatedSchedule);
      
      console.log("[Channels API POST] Success - returning channels:", channels.map(c => c.id));

      return NextResponse.json({
        channel: { id: normalizedId, shortName, active, type: scheduleType },
        channels,
        source,
      });
    } else {
      // Local mode
      const existingChannels = await listChannels("local");
      if (existingChannels.some((ch) => ch.id === normalizedId)) {
        return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
      }

      const result = await createChannel(normalizedId, shortName, scheduleType, active);
      const channels = await listChannels("local");

      return NextResponse.json({
        channel: { id: result.channel, shortName: result.shortName, active: result.active, type: result.type },
        channels,
        source,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    console.error("[Channels API POST] Error:", message, error);
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
    const newType = body?.type === "looping" || body?.type === "24hour" ? body.type : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    if (isRemote) {
      if (!isFtpConfigured()) {
        return NextResponse.json({ error: "FTP not configured" }, { status: 400 });
      }

      // Use atomic operation to prevent race conditions
      // CRITICAL: Use requireExistingOnError to prevent wiping existing channels
      let channelNotFound = false;
      let targetIdExists = false;
      let finalTargetId = id;
      const safetyOptions: AtomicUpdateOptions = { requireExistingOnError: true };

      const updatedSchedule = await atomicJsonUpdate<ScheduleData>(
        "schedule.json",
        (schedule) => {
          if (!schedule.channels[id]) {
            channelNotFound = true;
            return schedule; // No change if channel not found
          }

          let targetId = id;

          // Handle rename
          if (newIdRaw) {
            const normalizedNewId = normalizeChannelId(newIdRaw);
            if (normalizedNewId && normalizedNewId !== id) {
              if (schedule.channels[normalizedNewId]) {
                targetIdExists = true;
                return schedule; // No change if target ID exists
              }
              schedule.channels[normalizedNewId] = schedule.channels[id];
              delete schedule.channels[id];
              targetId = normalizedNewId;
            }
          }

          finalTargetId = targetId;

          // Handle type change - this clears the schedule
          const currentType = schedule.channels[targetId].type || "24hour";
          if (newType && newType !== currentType) {
            const channelData = schedule.channels[targetId];
            if (newType === "looping") {
              // Converting to looping: remove slots, add empty playlist
              delete channelData.slots;
              channelData.playlist = [];
              channelData.type = "looping";
            } else {
              // Converting to 24hour: remove playlist, add empty slots
              delete channelData.playlist;
              channelData.slots = [];
              channelData.type = "24hour";
            }
          }

          // Update properties
          if (shortName !== undefined) schedule.channels[targetId].shortName = shortName || undefined;
          if (active !== undefined) schedule.channels[targetId].active = active;

          return schedule;
        },
        { channels: {} },
        safetyOptions
      );

      if (channelNotFound) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }
      if (targetIdExists) {
        return NextResponse.json({ error: "Channel ID already exists" }, { status: 400 });
      }

      // Use the returned schedule data (fresh from FTP, not CDN)
      const channels = channelsFromSchedule(updatedSchedule);
      const updated = channels.find(c => c.id === finalTargetId);

      return NextResponse.json({
        channel: updated || { id: finalTargetId, active: true },
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

      // Handle type change for local
      if (newType) {
        const channelsList = await listChannels("local");
        const currentChannel = channelsList.find(ch => ch.id === targetId);
        const currentType = currentChannel?.type || "24hour";
        
        if (newType !== currentType) {
          // Load the full schedule to update the type
          const fullSchedule = await loadFullSchedule("local");
          if (fullSchedule.channels[targetId]) {
            const channelData = fullSchedule.channels[targetId];
            if (newType === "looping") {
              // Converting to looping: remove slots, add empty playlist
              delete channelData.slots;
              channelData.playlist = [];
              channelData.type = "looping";
            } else {
              // Converting to 24hour: remove playlist, add empty slots
              delete channelData.playlist;
              channelData.slots = [];
              channelData.type = "24hour";
            }
            
            // Save the updated schedule
            await saveFullSchedule(fullSchedule);
          }
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

      // Use atomic operation to prevent race conditions
      // CRITICAL: Use requireExistingOnError to prevent wiping existing channels
      let channelNotFound = false;
      const safetyOptions: AtomicUpdateOptions = { requireExistingOnError: true };
      const updatedSchedule = await atomicJsonUpdate<ScheduleData>(
        "schedule.json",
        (schedule) => {
          if (!schedule.channels[id]) {
            channelNotFound = true;
            return schedule; // No change if channel not found
          }

          delete schedule.channels[id];
          return schedule;
        },
        { channels: {} },
        safetyOptions
      );

      if (channelNotFound) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }

      // Use the returned schedule data (fresh from FTP, not CDN)
      const channels = channelsFromSchedule(updatedSchedule);

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
