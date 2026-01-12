import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getLocalScheduleFilePath, getLocalChannelsFilePath } from "@/lib/media";

export const runtime = "nodejs";

/**
 * POST /api/schedule/cleanup
 * Removes orphaned schedules (channels that exist in schedule.json but not in channels.json)
 */
export async function POST() {
  try {
    const scheduleFile = await getLocalScheduleFilePath();
    const channelsFile = await getLocalChannelsFilePath();
    
    // No folder configured
    if (!scheduleFile || !channelsFile) {
      return NextResponse.json({
        error: "No media folder configured. Please configure a folder in Source settings.",
      }, { status: 400 });
    }
    
    // Read channels.json to get valid channel IDs
    const channelsRaw = await fs.readFile(channelsFile, "utf8");
    const channelsData = JSON.parse(channelsRaw);
    const validChannelIds = new Set(
      Array.isArray(channelsData.channels)
        ? channelsData.channels.map((ch: { id: string }) => ch.id)
        : []
    );

    // Read schedule.json
    const scheduleRaw = await fs.readFile(scheduleFile, "utf8");
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
      scheduleFile,
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
    const scheduleFile = await getLocalScheduleFilePath();
    const channelsFile = await getLocalChannelsFilePath();
    
    // No folder configured
    if (!scheduleFile || !channelsFile) {
      return NextResponse.json({
        success: true,
        orphanedChannels: [],
        hasOrphans: false,
        totalSchedules: 0,
        validChannels: [],
        message: "No media folder configured",
      });
    }
    
    // Read channels.json to get valid channel IDs
    const channelsRaw = await fs.readFile(channelsFile, "utf8");
    const channelsData = JSON.parse(channelsRaw);
    const validChannelIds = new Set(
      Array.isArray(channelsData.channels)
        ? channelsData.channels.map((ch: { id: string }) => ch.id)
        : []
    );

    // Read schedule.json
    const scheduleRaw = await fs.readFile(scheduleFile, "utf8");
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
