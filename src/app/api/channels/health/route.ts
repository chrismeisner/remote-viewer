import { NextRequest, NextResponse } from "next/server";
import { loadFullSchedule } from "@/lib/media";
import { REMOTE_MEDIA_BASE, type MediaSource } from "@/constants/media";
import {
  isFtpConfigured,
  downloadJsonFromFtp,
} from "@/lib/ftp";
import fs from "node:fs/promises";
import path from "node:path";
import { getEffectiveMediaRoot } from "@/lib/config";

export const runtime = "nodejs";

// Maximum number of concurrent HTTP HEAD requests for remote checks
const MAX_CONCURRENT_REQUESTS = 10;

type ChannelHealthIssue = {
  file: string;
  title?: string;
  issue: "missing" | "unreachable" | "zero_duration";
  details: string;
};

type ChannelHealthResult = {
  channelId: string;
  shortName?: string;
  type: "24hour" | "looping";
  active: boolean;
  totalItems: number;
  healthyItems: number;
  issues: ChannelHealthIssue[];
};

type HealthCheckResult = {
  source: MediaSource;
  checkedAt: string;
  totalChannels: number;
  totalItems: number;
  totalIssues: number;
  channels: ChannelHealthResult[];
};

type RemoteMediaIndex = {
  items: Array<{ relPath: string; durationSeconds?: number }>;
};

/**
 * POST /api/channels/health?source=local|remote
 *
 * Performs a health check on all channels, verifying that every
 * referenced media file actually exists and is accessible.
 */
export async function POST(request: NextRequest) {
  const source = (request.nextUrl.searchParams.get("source") || "local") as MediaSource;
  const isRemote = source === "remote";

  console.log("[Health Check API] Starting health check", { source });

  try {
    // Load the full schedule
    const schedule = isRemote
      ? await loadRemoteSchedule()
      : await loadFullSchedule("local");

    if (!schedule || !schedule.channels || Object.keys(schedule.channels).length === 0) {
      return NextResponse.json({
        source,
        checkedAt: new Date().toISOString(),
        totalChannels: 0,
        totalItems: 0,
        totalIssues: 0,
        channels: [],
      } satisfies HealthCheckResult);
    }

    // Build a set of available media files
    const availableFiles = isRemote
      ? await getRemoteAvailableFiles()
      : await getLocalAvailableFiles();

    console.log("[Health Check API] Available files count:", availableFiles.size);

    // Check each channel
    const channelResults: ChannelHealthResult[] = [];

    for (const [channelId, channelData] of Object.entries(schedule.channels)) {
      const scheduleType = channelData.type || "24hour";
      const issues: ChannelHealthIssue[] = [];
      let totalItems = 0;

      if (scheduleType === "looping" && Array.isArray(channelData.playlist)) {
        totalItems = channelData.playlist.length;

        for (const item of channelData.playlist) {
          if (!item.file) {
            issues.push({
              file: "(empty)",
              title: item.title,
              issue: "missing",
              details: "Playlist item has no file path",
            });
            continue;
          }

          const normalizedFile = normalizePath(item.file);
          if (!availableFiles.has(normalizedFile)) {
            issues.push({
              file: item.file,
              title: item.title,
              issue: "missing",
              details: "File not found in media library",
            });
          }

          if (typeof item.durationSeconds === "number" && item.durationSeconds <= 0) {
            issues.push({
              file: item.file,
              title: item.title,
              issue: "zero_duration",
              details: "Item has zero or negative duration",
            });
          }
        }
      } else if (Array.isArray(channelData.slots)) {
        totalItems = channelData.slots.length;

        for (const slot of channelData.slots) {
          if (!slot.file) {
            issues.push({
              file: "(empty)",
              title: slot.title,
              issue: "missing",
              details: "Slot has no file path",
            });
            continue;
          }

          const normalizedFile = normalizePath(slot.file);
          if (!availableFiles.has(normalizedFile)) {
            issues.push({
              file: slot.file,
              title: slot.title,
              issue: "missing",
              details: "File not found in media library",
            });
          }
        }
      }

      channelResults.push({
        channelId,
        shortName: channelData.shortName,
        type: scheduleType as "24hour" | "looping",
        active: channelData.active !== false,
        totalItems,
        healthyItems: totalItems - issues.length,
        issues,
      });
    }

    // For remote mode, also do HTTP reachability checks on missing files
    // to confirm they're truly missing vs just not in the index
    if (isRemote) {
      const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
      if (base) {
        const allMissingFiles = new Set<string>();
        for (const ch of channelResults) {
          for (const issue of ch.issues) {
            if (issue.issue === "missing" && issue.file !== "(empty)") {
              allMissingFiles.add(issue.file);
            }
          }
        }

        if (allMissingFiles.size > 0) {
          console.log("[Health Check API] Verifying", allMissingFiles.size, "missing files via HTTP HEAD");
          const reachable = await checkRemoteReachability(base, Array.from(allMissingFiles));

          // Update issues for files that are actually reachable (just not in index)
          for (const ch of channelResults) {
            for (const issue of ch.issues) {
              if (issue.issue === "missing" && reachable.has(issue.file)) {
                // File exists on CDN but not in index - still fine
                issue.issue = "missing";
                issue.details = "File exists on CDN but not in media-index.json (may need re-scan)";
              }
            }
          }

          // Remove issues for files that are reachable
          for (const ch of channelResults) {
            const beforeCount = ch.issues.length;
            // Keep the issue but update the message - it's a soft warning
            ch.healthyItems = ch.totalItems - ch.issues.filter(i => !reachable.has(i.file)).length;
          }
        }
      }
    }

    // Sort channels numerically
    channelResults.sort((a, b) => {
      const aNum = parseInt(a.channelId, 10);
      const bNum = parseInt(b.channelId, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.channelId.localeCompare(b.channelId);
    });

    const totalItems = channelResults.reduce((s, c) => s + c.totalItems, 0);
    const totalIssues = channelResults.reduce((s, c) => s + c.issues.length, 0);

    const result: HealthCheckResult = {
      source,
      checkedAt: new Date().toISOString(),
      totalChannels: channelResults.length,
      totalItems,
      totalIssues,
      channels: channelResults,
    };

    console.log("[Health Check API] Complete", {
      channels: result.totalChannels,
      items: result.totalItems,
      issues: result.totalIssues,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed";
    console.error("[Health Check API] Error:", message, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "").replace(/\\/g, "/");
}

async function loadRemoteSchedule() {
  if (!isFtpConfigured()) {
    // Fall back to CDN
    const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
    if (!base) return { channels: {} };
    try {
      const res = await fetch(new URL("schedule.json", base).toString(), { cache: "no-store" });
      if (!res.ok) return { channels: {} };
      return await res.json();
    } catch {
      return { channels: {} };
    }
  }

  const schedule = await downloadJsonFromFtp("schedule.json");
  return schedule ?? { channels: {} };
}

async function getRemoteAvailableFiles(): Promise<Set<string>> {
  const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
  if (!base) return new Set();

  try {
    const manifestUrl = new URL("media-index.json", base).toString();
    const res = await fetch(manifestUrl, { cache: "no-store" });
    if (!res.ok) return new Set();

    const json = (await res.json()) as RemoteMediaIndex;
    const items = Array.isArray(json?.items) ? json.items : [];

    const set = new Set<string>();
    for (const item of items) {
      if (typeof item.relPath === "string") {
        set.add(normalizePath(item.relPath));
      }
    }
    return set;
  } catch (error) {
    console.warn("[Health Check API] Failed to load remote media index:", error);
    return new Set();
  }
}

async function getLocalAvailableFiles(): Promise<Set<string>> {
  const mediaRoot = await getEffectiveMediaRoot();
  if (!mediaRoot) return new Set();

  const ALLOWED_EXTENSIONS = [".mp4", ".mkv", ".mov", ".avi", ".m4v", ".webm"];
  const set = new Set<string>();

  async function walk(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const absPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ALLOWED_EXTENSIONS.includes(ext)) {
            const relPath = path.relative(mediaRoot, absPath);
            set.add(normalizePath(relPath));
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walk(mediaRoot);
  return set;
}

async function checkRemoteReachability(
  base: string,
  files: string[],
): Promise<Set<string>> {
  const reachable = new Set<string>();

  // Process in batches to avoid overwhelming the server
  for (let i = 0; i < files.length; i += MAX_CONCURRENT_REQUESTS) {
    const batch = files.slice(i, i + MAX_CONCURRENT_REQUESTS);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        try {
          const url = new URL(encodeURIComponent(file).replace(/%2F/g, "/"), base).toString();
          const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
          if (res.ok) {
            reachable.add(file);
          }
        } catch {
          // Not reachable
        }
      }),
    );
  }

  return reachable;
}
