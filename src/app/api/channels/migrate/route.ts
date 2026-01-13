import { NextResponse } from "next/server";
import { migrateChannelsToSchedule, listChannels } from "@/lib/media";

export const runtime = "nodejs";

/**
 * POST /api/channels/migrate
 * Migrates legacy channels.json data into schedule.json.
 * This is a one-time operation that merges shortName and active fields.
 */
export async function POST() {
  try {
    const result = await migrateChannelsToSchedule();
    const channels = await listChannels("local");

    return NextResponse.json({
      success: true,
      message: `Migration complete. ${result.migrated} channel(s) migrated, ${result.skipped} skipped.`,
      ...result,
      channels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
