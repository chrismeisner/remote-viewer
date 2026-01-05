import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getLocalScheduleFilePath, getLocalChannelsFilePath } from "@/lib/media";

export const runtime = "nodejs";

const SCHEDULE_FILE = getLocalScheduleFilePath();
const CHANNELS_FILE = getLocalChannelsFilePath();

/**
 * POST /api/schedule/cleanup
 * Removes orphaned schedules (channels that exist in schedule.json but not in channels.json)
 */
export async function POST() {
  try {
    // Read channels.json to get valid channel IDs
    const channelsRaw = await fs.readFile(CHANNELS_FILE, "utf8");
    const channelsData = JSON.parse(channelsRaw);
    const validChannelIds = new Set(
      Array.isArray(channelsData.channels)
        ? channelsData.channels.map((ch: { id: string }) => ch.id)
        : []
    );

    // Read schedule.json
    const scheduleRaw = await fs.readFile(SCHEDULE_FILE, "utf8");
    const scheduleData = JSON.parse(scheduleRaw);

    if (!scheduleData.channels || typeof scheduleData.channels !== "object") {
      return NextResponse.json({ 
        error: "Invalid schedule.json structure" 
      }, { status: 400 });
    }

    // Find orphaned channels
    const allScheduleChannels = Object.keys(scheduleData.channels);
    const orphanedChannels = allScheduleChannels.filter(
      (channelId) => !validChannelIds.has(channelId)
    );

    if (orphanedChannels.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No orphaned schedules found",
        orphanedChannels: [],
      });
    }

    // Remove orphaned schedules
    for (const channelId of orphanedChannels) {
      delete scheduleData.channels[channelId];
    }

    // Save cleaned schedule
    await fs.writeFile(
      SCHEDULE_FILE,
      JSON.stringify(scheduleData, null, 2),
      "utf8"
    );

    return NextResponse.json({
      success: true,
      message: `Removed ${orphanedChannels.length} orphaned schedule(s)`,
      orphanedChannels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/schedule/cleanup
 * Check for orphaned schedules without removing them
 */
export async function GET() {
  try {
    // Read channels.json to get valid channel IDs
    const channelsRaw = await fs.readFile(CHANNELS_FILE, "utf8");
    const channelsData = JSON.parse(channelsRaw);
    const validChannelIds = new Set(
      Array.isArray(channelsData.channels)
        ? channelsData.channels.map((ch: { id: string }) => ch.id)
        : []
    );

    // Read schedule.json
    const scheduleRaw = await fs.readFile(SCHEDULE_FILE, "utf8");
    const scheduleData = JSON.parse(scheduleRaw);

    if (!scheduleData.channels || typeof scheduleData.channels !== "object") {
      return NextResponse.json({ 
        error: "Invalid schedule.json structure" 
      }, { status: 400 });
    }

    // Find orphaned channels
    const allScheduleChannels = Object.keys(scheduleData.channels);
    const orphanedChannels = allScheduleChannels.filter(
      (channelId) => !validChannelIds.has(channelId)
    );

    return NextResponse.json({
      success: true,
      orphanedChannels,
      hasOrphans: orphanedChannels.length > 0,
      totalSchedules: allScheduleChannels.length,
      validChannels: Array.from(validChannelIds),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

