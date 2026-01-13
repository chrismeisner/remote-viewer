import { NextResponse } from "next/server";
import { loadFullSchedule } from "@/lib/media";
import { isFtpConfigured, uploadJsonToFtp } from "@/lib/ftp";
import type { Schedule } from "@/lib/schedule";

type PushResult = {
  success: boolean;
  message: string;
  remotePath?: string;
};

export const runtime = "nodejs";

/**
 * Normalize schedule for pushing to remote.
 * Ensures all channels have explicit active field (defaults to true if missing).
 */
function normalizeScheduleForPush(schedule: Schedule): Schedule {
  const normalizedChannels: Schedule["channels"] = {};
  
  for (const [id, channel] of Object.entries(schedule.channels)) {
    normalizedChannels[id] = {
      ...channel,
      active: channel.active ?? true, // Explicit default
    };
  }
  
  return {
    ...schedule,
    channels: normalizedChannels,
  };
}

export async function POST() {
  if (!isFtpConfigured()) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Missing FTP env vars (FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH). Set these in your environment.",
      } satisfies PushResult,
      { status: 400 },
    );
  }

  try {
    const schedule = await loadFullSchedule("local");
    const normalizedSchedule = normalizeScheduleForPush(schedule);
    const targetPath = await uploadJsonToFtp("schedule.json", normalizedSchedule);

    const channelCount = Object.keys(schedule.channels).length;
    return NextResponse.json({
      success: true,
      message: `Uploaded schedule.json (${channelCount} channel${channelCount === 1 ? "" : "s"}) to ${targetPath}`,
      remotePath: targetPath,
    } satisfies PushResult);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Upload failed: ${msg}` } satisfies PushResult,
      { status: 500 },
    );
  }
}

