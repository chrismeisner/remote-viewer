import { NextRequest, NextResponse } from "next/server";
import {
  getScheduleItems,
  loadMediaMetadata,
  saveMediaMetadata,
  loadFullSchedule,
  saveFullSchedule,
} from "@/lib/media";
import { hasMediaRootConfigured } from "@/lib/config";

export const runtime = "nodejs";

export type CleanupResult = {
  success: boolean;
  message: string;
  stats: {
    currentMediaCount: number;
    metadataEntriesBefore: number;
    metadataEntriesRemoved: number;
    scheduleReferencesRemoved: number;
    affectedChannels: string[];
  };
};

/**
 * POST /api/media-index/cleanup
 * Remove orphaned entries from media-metadata.json and schedule.json
 * that reference files no longer in the media folder.
 */
export async function POST(request: NextRequest) {
  try {
    // Check if configured
    const configured = await hasMediaRootConfigured();
    if (!configured) {
      return NextResponse.json(
        { success: false, message: "No media folder configured" },
        { status: 400 }
      );
    }

    // Check for dry-run mode
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";

    // Get current media files (fresh scan)
    const currentFiles = await getScheduleItems({ refresh: true });
    const currentFilePaths = new Set(currentFiles.map((f) => f.relPath));

    // Track stats
    let metadataEntriesRemoved = 0;
    let scheduleReferencesRemoved = 0;
    const affectedChannels: string[] = [];

    // 1. Clean up media-metadata.json
    const metadata = await loadMediaMetadata();
    const metadataEntriesBefore = Object.keys(metadata.items).length;
    const cleanedMetadata = { items: { ...metadata.items } };

    for (const relPath of Object.keys(cleanedMetadata.items)) {
      if (!currentFilePaths.has(relPath)) {
        delete cleanedMetadata.items[relPath];
        metadataEntriesRemoved++;
      }
    }

    // 2. Clean up schedule.json - remove slots referencing missing files
    const schedule = await loadFullSchedule("local");
    
    for (const [channelId, channelData] of Object.entries(schedule.channels)) {
      let channelModified = false;
      
      // Handle 24hour schedule slots
      if (channelData.slots && Array.isArray(channelData.slots)) {
        const originalSlotCount = channelData.slots.length;
        channelData.slots = channelData.slots.filter((slot) => {
          const exists = currentFilePaths.has(slot.file);
          if (!exists) {
            scheduleReferencesRemoved++;
            channelModified = true;
          }
          return exists;
        });
        if (channelData.slots.length !== originalSlotCount) {
          channelModified = true;
        }
      }
      
      // Handle looping playlist
      if (channelData.playlist && Array.isArray(channelData.playlist)) {
        const originalPlaylistCount = channelData.playlist.length;
        channelData.playlist = channelData.playlist.filter((item) => {
          const exists = currentFilePaths.has(item.file);
          if (!exists) {
            scheduleReferencesRemoved++;
            channelModified = true;
          }
          return exists;
        });
        if (channelData.playlist.length !== originalPlaylistCount) {
          channelModified = true;
        }
      }
      
      if (channelModified) {
        affectedChannels.push(channelId);
      }
    }

    // Save changes (unless dry-run)
    if (!dryRun) {
      if (metadataEntriesRemoved > 0) {
        await saveMediaMetadata(cleanedMetadata);
      }
      if (scheduleReferencesRemoved > 0) {
        await saveFullSchedule(schedule);
      }
    }

    const result: CleanupResult = {
      success: true,
      message: dryRun
        ? `Dry run: Would remove ${metadataEntriesRemoved} orphaned metadata entries and ${scheduleReferencesRemoved} broken schedule references`
        : metadataEntriesRemoved > 0 || scheduleReferencesRemoved > 0
          ? `Cleaned up ${metadataEntriesRemoved} orphaned metadata entries and ${scheduleReferencesRemoved} broken schedule references`
          : "No orphaned entries found - everything is clean",
      stats: {
        currentMediaCount: currentFiles.length,
        metadataEntriesBefore,
        metadataEntriesRemoved,
        scheduleReferencesRemoved,
        affectedChannels,
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/media-index/cleanup
 * Preview what would be cleaned up (dry run).
 */
export async function GET() {
  try {
    // Check if configured
    const configured = await hasMediaRootConfigured();
    if (!configured) {
      return NextResponse.json(
        { success: false, message: "No media folder configured" },
        { status: 400 }
      );
    }

    // Get current media files (fresh scan)
    const currentFiles = await getScheduleItems({ refresh: true });
    const currentFilePaths = new Set(currentFiles.map((f) => f.relPath));

    // Check media-metadata.json for orphans
    const metadata = await loadMediaMetadata();
    const orphanedMetadata: string[] = [];
    
    for (const relPath of Object.keys(metadata.items)) {
      if (!currentFilePaths.has(relPath)) {
        orphanedMetadata.push(relPath);
      }
    }

    // Check schedule.json for broken references
    const schedule = await loadFullSchedule("local");
    const brokenReferences: Array<{ channel: string; file: string; type: "slot" | "playlist" }> = [];
    
    for (const [channelId, channelData] of Object.entries(schedule.channels)) {
      // Check 24hour slots
      if (channelData.slots && Array.isArray(channelData.slots)) {
        for (const slot of channelData.slots) {
          if (!currentFilePaths.has(slot.file)) {
            brokenReferences.push({ channel: channelId, file: slot.file, type: "slot" });
          }
        }
      }
      
      // Check looping playlist
      if (channelData.playlist && Array.isArray(channelData.playlist)) {
        for (const item of channelData.playlist) {
          if (!currentFilePaths.has(item.file)) {
            brokenReferences.push({ channel: channelId, file: item.file, type: "playlist" });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      currentMediaCount: currentFiles.length,
      orphanedMetadata,
      brokenReferences,
      needsCleanup: orphanedMetadata.length > 0 || brokenReferences.length > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview failed";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
