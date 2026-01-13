import { NextRequest, NextResponse } from "next/server";
import { loadSchedule, saveSchedule, loadFullSchedule, clearMediaCaches } from "@/lib/media";
import type { ChannelSchedule, Schedule } from "@/lib/schedule";
import type { MediaSource } from "@/constants/media";
import { isFtpConfigured, uploadJsonToFtp, normalizeChannelId } from "@/lib/ftp";

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

      // Load existing schedule from remote
      const fullSchedule = await loadFullSchedule("remote");

      // Update the channel's schedule - preserve existing shortName, active, etc.
      const existingChannel = fullSchedule.channels[channelId] || {};
      fullSchedule.channels[channelId] = {
        ...existingChannel,
        slots: payload.slots,
      };

      // Normalize schedule for pushing (ensure active field is explicit)
      const normalizedSchedule = normalizeScheduleForPush(fullSchedule);

      // Push directly to FTP
      await uploadJsonToFtp("schedule.json", normalizedSchedule);

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


