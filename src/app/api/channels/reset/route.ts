import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  loadFullSchedule,
  clearMediaCaches,
} from "@/lib/media";
import { isFtpConfigured, writeJsonToFtpWithLock, downloadJsonFromFtp, uploadJsonToFtp } from "@/lib/ftp";
import { getEffectiveMediaRoot, getDataFolderForMediaRoot } from "@/lib/config";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the active local data folder (same logic as media.ts / json-audit).
 * Falls back to data/local/ when the media root is not configured or not writable.
 */
async function resolveLocalDataFolder(): Promise<string> {
  const mediaRoot = await getEffectiveMediaRoot();
  if (mediaRoot) {
    const dataRoot = getDataFolderForMediaRoot(mediaRoot);
    try {
      await fs.mkdir(dataRoot, { recursive: true });
      const testFile = path.join(dataRoot, ".write-test");
      await fs.writeFile(testFile, "test");
      await fs.unlink(testFile);
      return dataRoot;
    } catch {
      // fall through to fallback
    }
  }
  const fallbackRoot = path.join(process.cwd(), "data", "local");
  await fs.mkdir(fallbackRoot, { recursive: true });
  return fallbackRoot;
}

/**
 * Write clean empty data files to a folder and optionally delete deprecated ones.
 */
async function writeCleanFiles(folder: string): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "schedule.json"), JSON.stringify({ channels: {} }, null, 2));
  await fs.writeFile(path.join(folder, "media-index.json"), JSON.stringify({ items: [], generatedAt: new Date().toISOString() }, null, 2));
  await fs.writeFile(path.join(folder, "media-metadata.json"), JSON.stringify({ items: {} }, null, 2));
  // Remove deprecated channels.json if present
  const deprecated = path.join(folder, "channels.json");
  if (await fileExists(deprecated)) {
    await fs.unlink(deprecated);
  }
}

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

      // Push empty files to remote (same as fresh-start does)
      console.log("[Reset API] Remote - uploading clean files via FTP");
      const emptySchedule: ScheduleData = { channels: {} };
      const uploadedPath = await writeJsonToFtpWithLock("schedule.json", emptySchedule);
      console.log("[Reset API] Remote - schedule uploaded to:", uploadedPath);

      // Also clear media-index and media-metadata so stale entries don't reappear
      await uploadJsonToFtp("media-index.json", { items: [], generatedAt: new Date().toISOString() });
      await uploadJsonToFtp("media-metadata.json", { items: {} });

      // Clear in-memory caches
      clearMediaCaches();

      console.log("[Reset API] Remote - SUCCESS");

      return NextResponse.json({
        ok: true,
        message: "All remote channels, schedules, and media index have been reset",
        previousChannelCount: currentChannelCount,
        channels: [],
        source,
      });
    } else {
      console.log("[Reset API] Step 1: Resolving active data folder");
      const dataFolder = await resolveLocalDataFolder();
      console.log("[Reset API] Active data folder:", dataFolder);

      console.log("[Reset API] Step 2: Clearing caches");
      clearMediaCaches();

      console.log("[Reset API] Step 3: Writing clean files to active folder");
      await writeCleanFiles(dataFolder);

      // Also wipe the fallback data/local/ folder so stale data can't resurface
      // after a server restart or transient error that causes a fallback.
      const fallbackFolder = path.join(process.cwd(), "data", "local");
      if (path.resolve(dataFolder) !== path.resolve(fallbackFolder)) {
        console.log("[Reset API] Step 4: Wiping fallback data/local/ folder");
        try {
          await writeCleanFiles(fallbackFolder);
        } catch (err) {
          console.warn("[Reset API] Could not wipe fallback folder:", err);
        }
      }

      console.log("[Reset API] Step 5: Clearing caches after write");
      clearMediaCaches();

      console.log("[Reset API] Step 6: Verifying via loadFullSchedule");
      const verifySchedule = await loadFullSchedule("local");
      const channelCount = Object.keys(verifySchedule.channels || {}).length;

      console.log("[Reset API] Verification result:", { channelCount });

      if (channelCount > 0) {
        console.error("[Reset API] VERIFICATION FAILED - channels still exist:", channelCount);
        return NextResponse.json({
          error: `Reset may have failed - ${channelCount} channels still found`,
        }, { status: 500 });
      }

      console.log("[Reset API] SUCCESS - all data reset");
      return NextResponse.json({
        ok: true,
        message: "All local channels, schedules, and media index have been reset",
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
