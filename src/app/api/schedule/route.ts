import { NextRequest, NextResponse } from "next/server";
import { loadSchedule, loadFullSchedule, saveSchedule, clearMediaCaches } from "@/lib/media";
import type { ChannelSchedule, Schedule } from "@/lib/schedule";
import type { MediaSource } from "@/constants/media";
import { isFtpConfigured, normalizeChannelId, atomicJsonUpdate } from "@/lib/ftp";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source: MediaSource =
    sourceParam === "remote" || sourceParam === "local" ? sourceParam : "local";

  // Clear cache for local source to ensure fresh reads
  if (source === "local") {
    clearMediaCaches();
  }

  // If no channel specified, return full schedule with all channels
  if (!channel) {
    const fullSchedule = await loadFullSchedule(source);
    return NextResponse.json({ schedule: fullSchedule, source });
  }

  // Otherwise return single channel's schedule
  const schedule = await loadSchedule(channel, source);
  return NextResponse.json({ schedule, source });
}

export async function PUT(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  const sourceParam = request.nextUrl.searchParams.get("source");

  // For remote source, save directly to FTP (for Heroku/serverless where local filesystem is read-only)
  if (sourceParam === "remote") {
    if (!isFtpConfigured()) {
      return NextResponse.json(
        { error: "FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH." },
        { status: 400 },
      );
    }

    try {
      const payload = (await request.json()) as ChannelSchedule;
      const channelId = normalizeChannelId(channel);
      const scheduleType = payload.type || "24hour";

      // Use atomic operation to prevent race conditions
      // This reads directly from FTP, modifies, and writes back with locking
      await atomicJsonUpdate<Schedule>(
        "schedule.json",
        (fullSchedule) => {
          // Update the channel's schedule - preserve existing shortName, active, etc.
          const existingChannel = fullSchedule.channels[channelId] || {};
          
          if (scheduleType === "looping") {
            fullSchedule.channels[channelId] = {
              ...existingChannel,
              type: "looping",
              playlist: payload.playlist,
              slots: undefined,
            };
          } else {
            fullSchedule.channels[channelId] = {
              ...existingChannel,
              type: "24hour",
              slots: payload.slots,
              playlist: undefined,
            };
          }

          // Normalize schedule for pushing (ensure active field is explicit)
          return normalizeScheduleForPush(fullSchedule);
        },
        { channels: {} }
      );

      return NextResponse.json({ schedule: payload, source: "remote" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save schedule to remote";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Local source - save to local filesystem
  try {
    const payload = (await request.json()) as ChannelSchedule;
    const saved = await saveSchedule(payload, channel);
    return NextResponse.json({ schedule: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save schedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * Normalize schedule for pushing to remote.
 * Ensures all channels have explicit active field (defaults to true if missing).
 */
function normalizeScheduleForPush(schedule: Schedule): Schedule {
  const normalizedChannels: Schedule["channels"] = {};

  for (const [id, channel] of Object.entries(schedule.channels)) {
    normalizedChannels[id] = {
      ...channel,
      active: channel.active ?? true,
    };
  }

  return {
    ...schedule,
    channels: normalizedChannels,
  };
}


