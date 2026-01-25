import { NextRequest, NextResponse } from "next/server";
import {
  saveFullSchedule,
  loadFullSchedule,
  clearMediaCaches,
} from "@/lib/media";
import { isFtpConfigured, writeJsonToFtpWithLock, downloadJsonFromFtp } from "@/lib/ftp";

export const runtime = "nodejs";

type ScheduleData = {
  channels: Record<string, { slots?: unknown[]; shortName?: string; active?: boolean }>;
};

/**
 * POST /api/channels/reset?source=local|remote
 * 
 * Deletes ALL channels and their schedules for the specified source.
 * This is a destructive operation that cannot be undone.
 */
export async function POST(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source") || "local";
  const isRemote = source === "remote";

  console.log("[Reset API] POST called", { source, isRemote });

  try {
    if (isRemote) {
      if (!isFtpConfigured()) {
        return NextResponse.json({ error: "FTP not configured" }, { status: 400 });
      }

      // Check current state before reset (read directly from FTP, not CDN)
      let currentChannelCount = 0;
      try {
        const currentSchedule = await downloadJsonFromFtp<ScheduleData>("schedule.json");
        currentChannelCount = currentSchedule ? Object.keys(currentSchedule.channels || {}).length : 0;
      } catch {
        // File might not exist
        currentChannelCount = 0;
      }
      console.log("[Reset API] Remote - current channel count:", currentChannelCount);

      // Push empty schedule to remote with locking
      console.log("[Reset API] Remote - uploading empty schedule.json via FTP");
      const emptySchedule: ScheduleData = { channels: {} };
      const uploadedPath = await writeJsonToFtpWithLock("schedule.json", emptySchedule);
      console.log("[Reset API] Remote - uploaded to:", uploadedPath);

      // Note: We can't verify immediately due to CDN caching, but the FTP upload succeeded
      console.log("[Reset API] Remote - SUCCESS (FTP upload complete, CDN may take time to update)");

      return NextResponse.json({
        ok: true,
        message: "All remote channels and schedules have been deleted",
        previousChannelCount: currentChannelCount,
        channels: [],
        source,
      });
    } else {
      console.log("[Reset API] Step 1: Clearing caches BEFORE save");
      clearMediaCaches();
      
      console.log("[Reset API] Step 2: Saving empty schedule");
      const emptySchedule = { channels: {} };
      await saveFullSchedule(emptySchedule);
      
      console.log("[Reset API] Step 3: Clearing caches AFTER save");
      clearMediaCaches();
      
      console.log("[Reset API] Step 4: Verifying save by reading back");
      const verifySchedule = await loadFullSchedule("local");
      const channelCount = Object.keys(verifySchedule.channels || {}).length;
      
      console.log("[Reset API] Verification result:", { channelCount, channels: Object.keys(verifySchedule.channels || {}) });
      
      if (channelCount > 0) {
        console.error("[Reset API] VERIFICATION FAILED - channels still exist:", channelCount);
        return NextResponse.json({ 
          error: `Reset may have failed - ${channelCount} channels still found` 
        }, { status: 500 });
      }

      console.log("[Reset API] SUCCESS - all channels deleted");
      return NextResponse.json({
        ok: true,
        message: "All local channels and schedules have been deleted",
        channels: [],
        source,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset channels";
    console.error("[Reset API] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
