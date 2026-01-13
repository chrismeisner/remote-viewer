import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { listChannels } from "@/lib/media";
import { getEffectiveMediaRoot, getDataFolderForMediaRoot, isLocalMode } from "@/lib/config";
import { REMOTE_MEDIA_BASE } from "@/constants/media";

export const runtime = "nodejs";

type AuditIssue = {
  id: string;
  file: string;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  fixable: boolean;
  fixAction?: string;
};

type AuditResult = {
  success: boolean;
  mode: "local" | "remote";
  issues: AuditIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    fixable: number;
  };
  files: {
    name: string;
    exists: boolean;
    path?: string;
    url?: string;
    size?: number;
  }[];
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function getFileSize(filePath: string): Promise<number | undefined> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return undefined;
  }
}

async function fetchRemoteJson<T>(url: string): Promise<{ data: T | null; exists: boolean; error?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) {
      return { data: null, exists: false };
    }
    if (!res.ok) {
      return { data: null, exists: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { data: data as T, exists: true };
  } catch (err) {
    return { data: null, exists: false, error: err instanceof Error ? err.message : "Fetch failed" };
  }
}

// ==================== REMOTE MODE AUDIT ====================
async function auditRemoteMode(): Promise<AuditResult> {
  const issues: AuditIssue[] = [];
  const files: AuditResult["files"] = [];

  const remoteFiles = [
    { name: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json` },
    { name: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json` },
    { name: "channels.json", url: `${REMOTE_MEDIA_BASE}channels.json` },
  ];

  for (const file of remoteFiles) {
    const result = await fetchRemoteJson<Record<string, unknown>>(file.url);
    files.push({
      name: file.name,
      exists: result.exists,
      url: file.url,
    });

    if (!result.exists) {
      // channels.json is optional/deprecated, so just info
      if (file.name === "channels.json") {
        issues.push({
          id: `remote-missing-${file.name}`,
          file: file.name,
          severity: "info",
          title: `${file.name} not found on remote`,
          description: "This file is optional (deprecated). Push from local to create it.",
          fixable: false,
        });
      } else {
        issues.push({
          id: `remote-missing-${file.name}`,
          file: file.name,
          severity: "error",
          title: `${file.name} not found on remote`,
          description: result.error || "File does not exist on remote CDN. Push from local to create it.",
          fixable: false,
        });
      }
    }
  }

  // Check schedule.json structure
  const scheduleResult = await fetchRemoteJson<{ channels?: Record<string, { slots?: unknown[]; shortName?: string; active?: boolean }> }>(
    `${REMOTE_MEDIA_BASE}schedule.json`
  );
  
  if (scheduleResult.exists && scheduleResult.data?.channels) {
    for (const [channelId, channelData] of Object.entries(scheduleResult.data.channels)) {
      if (channelData.active === undefined) {
        issues.push({
          id: `remote-schedule-missing-active-${channelId}`,
          file: "schedule.json",
          severity: "info",
          title: `Channel "${channelId}" missing 'active' field`,
          description: "Re-push schedule.json from local to normalize.",
          fixable: false,
        });
      }
    }
  }

  // Check media-index.json
  const mediaResult = await fetchRemoteJson<{ items?: { relPath: string; durationSeconds?: number }[] }>(
    `${REMOTE_MEDIA_BASE}media-index.json`
  );
  
  if (mediaResult.exists && mediaResult.data?.items) {
    const missingDuration = mediaResult.data.items.filter(i => !i.durationSeconds || i.durationSeconds <= 0);
    if (missingDuration.length > 0) {
      issues.push({
        id: "remote-media-missing-duration",
        file: "media-index.json",
        severity: "warning",
        title: `${missingDuration.length} files missing duration`,
        description: "Re-scan local media and push to fix.",
        fixable: false,
      });
    }
  }

  const summary = {
    total: issues.length,
    errors: issues.filter(i => i.severity === "error").length,
    warnings: issues.filter(i => i.severity === "warning").length,
    info: issues.filter(i => i.severity === "info").length,
    fixable: issues.filter(i => i.fixable).length,
  };

  return { success: true, mode: "remote", issues, summary, files };
}

// ==================== LOCAL MODE AUDIT ====================
async function auditLocalMode(): Promise<AuditResult> {
  const issues: AuditIssue[] = [];
  const files: AuditResult["files"] = [];

  const mediaRoot = await getEffectiveMediaRoot();
  
  if (!mediaRoot) {
    return {
      success: false,
      mode: "local",
      issues: [{
        id: "no-data-folder",
        file: "config",
        severity: "error",
        title: "No media folder configured",
        description: "Configure a media folder in Source settings first.",
        fixable: false,
      }],
      summary: { total: 1, errors: 1, warnings: 0, info: 0, fixable: 0 },
      files: [],
    };
  }
  
  const dataFolder = getDataFolderForMediaRoot(mediaRoot);

  // Define all JSON files to audit
  const jsonFiles = [
    { name: "schedule.json", path: path.join(dataFolder, "schedule.json") },
    { name: "channels.json", path: path.join(dataFolder, "channels.json") },
    { name: "media-index.json", path: path.join(dataFolder, "media-index.json") },
    { name: "media-metadata.json", path: path.join(dataFolder, "media-metadata.json") },
  ];

  // Check file existence and collect metadata
  for (const file of jsonFiles) {
    const exists = await fileExists(file.path);
    files.push({
      name: file.name,
      exists,
      path: file.path,
      size: exists ? await getFileSize(file.path) : undefined,
    });
  }

  // ========== AUDIT: schedule.json ==========
  const schedulePath = path.join(dataFolder, "schedule.json");
  if (await fileExists(schedulePath)) {
    const schedule = await readJsonFile<{ channels: Record<string, { slots?: unknown[]; shortName?: string; active?: boolean }> }>(schedulePath);
    
    if (schedule?.channels) {
      for (const [channelId, channelData] of Object.entries(schedule.channels)) {
        if (channelData.active === undefined) {
          issues.push({
            id: `schedule-missing-active-${channelId}`,
            file: "schedule.json",
            severity: "warning",
            title: `Channel "${channelId}" missing 'active' field`,
            description: "The channel doesn't have an explicit active status. It defaults to true but should be explicit.",
            fixable: true,
            fixAction: "normalize-schedule",
          });
        }

        if (!channelData.shortName) {
          issues.push({
            id: `schedule-missing-shortname-${channelId}`,
            file: "schedule.json",
            severity: "info",
            title: `Channel "${channelId}" has no shortName`,
            description: "Consider adding a short display name for this channel.",
            fixable: false,
          });
        }

        if (!channelData.slots || channelData.slots.length === 0) {
          issues.push({
            id: `schedule-empty-slots-${channelId}`,
            file: "schedule.json",
            severity: "info",
            title: `Channel "${channelId}" has no schedule slots`,
            description: "This channel has no scheduled media. Add slots via the Schedule page.",
            fixable: false,
          });
        }
      }
    }
  }

  // ========== AUDIT: channels.json (DEPRECATED) ==========
  const channelsPath = path.join(dataFolder, "channels.json");
  if (await fileExists(channelsPath)) {
    issues.push({
      id: "channels-deprecated",
      file: "channels.json",
      severity: "warning",
      title: "Deprecated channels.json file exists",
      description: "Channel data is now stored in schedule.json. This file can be deleted.",
      fixable: true,
      fixAction: "delete-channels-json",
    });

    const channelsFile = await readJsonFile<{ channels: { id: string; shortName?: string; active?: boolean }[] }>(channelsPath);
    const scheduleChannels = await listChannels("local");
    
    if (channelsFile?.channels) {
      const channelsJsonIds = new Set(channelsFile.channels.map(c => c.id));
      const scheduleIds = new Set(scheduleChannels.map(c => c.id));
      
      for (const id of channelsJsonIds) {
        if (!scheduleIds.has(id)) {
          issues.push({
            id: `channels-orphan-${id}`,
            file: "channels.json",
            severity: "warning",
            title: `Channel "${id}" exists only in channels.json`,
            description: "This channel exists in the deprecated channels.json but not in schedule.json.",
            fixable: true,
            fixAction: "delete-channels-json",
          });
        }
      }
    }
  }

  // ========== AUDIT: media-index.json ==========
  const mediaIndexPath = path.join(dataFolder, "media-index.json");
  if (await fileExists(mediaIndexPath)) {
    const mediaIndex = await readJsonFile<{ items?: { relPath: string; durationSeconds?: number }[]; generatedAt?: string }>(mediaIndexPath);
    
    if (mediaIndex?.items && mediaRoot) {
      let staleCount = 0;
      for (const item of mediaIndex.items) {
        const fullPath = path.join(mediaRoot, item.relPath);
        if (!(await fileExists(fullPath))) {
          staleCount++;
        }
      }
      
      if (staleCount > 0) {
        issues.push({
          id: "media-index-stale",
          file: "media-index.json",
          severity: "warning",
          title: `${staleCount} stale media entries`,
          description: `Found ${staleCount} file(s) in media-index.json that no longer exist on disk.`,
          fixable: true,
          fixAction: "rescan-media",
        });
      }

      const missingDuration = mediaIndex.items.filter(i => !i.durationSeconds || i.durationSeconds <= 0);
      if (missingDuration.length > 0) {
        issues.push({
          id: "media-index-missing-duration",
          file: "media-index.json",
          severity: "warning",
          title: `${missingDuration.length} files missing duration`,
          description: "Some media files don't have duration metadata. Re-scan to probe files.",
          fixable: true,
          fixAction: "rescan-media",
        });
      }
    }

    if (mediaIndex?.generatedAt) {
      const generatedDate = new Date(mediaIndex.generatedAt);
      const ageMs = Date.now() - generatedDate.getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      
      if (ageDays > 7) {
        issues.push({
          id: "media-index-old",
          file: "media-index.json",
          severity: "info",
          title: `Media index is ${ageDays} days old`,
          description: "Consider re-scanning to pick up any new files.",
          fixable: true,
          fixAction: "rescan-media",
        });
      }
    }
  } else {
    issues.push({
      id: "media-index-missing",
      file: "media-index.json",
      severity: "error",
      title: "Media index not found",
      description: "No media-index.json file exists. Scan your media folder to create one.",
      fixable: true,
      fixAction: "rescan-media",
    });
  }

  // ========== AUDIT: media-metadata.json ==========
  const metadataPath = path.join(dataFolder, "media-metadata.json");
  if (await fileExists(metadataPath)) {
    const metadata = await readJsonFile<Record<string, unknown>>(metadataPath);
    const mediaIndex = await readJsonFile<{ items?: { relPath: string }[] }>(path.join(dataFolder, "media-index.json"));
    
    if (metadata && mediaIndex?.items) {
      const indexPaths = new Set(mediaIndex.items.map(i => i.relPath));
      const orphanedKeys = Object.keys(metadata).filter(key => !indexPaths.has(key));
      
      if (orphanedKeys.length > 0) {
        issues.push({
          id: "metadata-orphaned",
          file: "media-metadata.json",
          severity: "info",
          title: `${orphanedKeys.length} orphaned metadata entries`,
          description: "Some metadata entries reference files that no longer exist in the media index.",
          fixable: true,
          fixAction: "clean-metadata",
        });
      }
    }
  }

  const summary = {
    total: issues.length,
    errors: issues.filter(i => i.severity === "error").length,
    warnings: issues.filter(i => i.severity === "warning").length,
    info: issues.filter(i => i.severity === "info").length,
    fixable: issues.filter(i => i.fixable).length,
  };

  return { success: true, mode: "local", issues, summary, files };
}

// ==================== GET HANDLER ====================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") as "local" | "remote" | null;
    
    // If mode specified, use that; otherwise detect
    if (mode === "remote") {
      return NextResponse.json(await auditRemoteMode());
    } else if (mode === "local") {
      return NextResponse.json(await auditLocalMode());
    }
    
    // Auto-detect: if local mode is available and configured, use local; otherwise remote
    if (isLocalMode()) {
      const mediaRoot = await getEffectiveMediaRoot();
      if (mediaRoot) {
        return NextResponse.json(await auditLocalMode());
      }
    }
    
    // Default to remote mode for cloud deployments
    return NextResponse.json(await auditRemoteMode());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, mode: "unknown", issues: [], summary: { total: 0, errors: 0, warnings: 0, info: 0, fixable: 0 }, files: [], error: msg },
      { status: 500 }
    );
  }
}

// ==================== POST HANDLER (fixes - local only) ====================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    const mediaRoot = await getEffectiveMediaRoot();
    if (!mediaRoot) {
      return NextResponse.json({ success: false, message: "No data folder configured. Fixes only available in local mode." }, { status: 400 });
    }
    const dataFolder = getDataFolderForMediaRoot(mediaRoot);

    switch (action) {
      case "normalize-schedule": {
        const schedulePath = path.join(dataFolder, "schedule.json");
        const schedule = await readJsonFile<{ channels: Record<string, { slots?: unknown[]; shortName?: string; active?: boolean }> }>(schedulePath);
        
        if (!schedule) {
          return NextResponse.json({ success: false, message: "Could not read schedule.json" }, { status: 400 });
        }

        let fixed = 0;
        for (const channelData of Object.values(schedule.channels)) {
          if (channelData.active === undefined) {
            channelData.active = true;
            fixed++;
          }
        }

        await fs.writeFile(schedulePath, JSON.stringify(schedule, null, 2));
        return NextResponse.json({ success: true, message: `Normalized ${fixed} channel(s) with explicit active status` });
      }

      case "delete-channels-json": {
        const channelsPath = path.join(dataFolder, "channels.json");
        if (await fileExists(channelsPath)) {
          await fs.unlink(channelsPath);
          return NextResponse.json({ success: true, message: "Deleted deprecated channels.json" });
        }
        return NextResponse.json({ success: true, message: "channels.json already deleted" });
      }

      case "rescan-media": {
        const mediaIndexPath = path.join(dataFolder, "media-index.json");
        const mediaIndex = await readJsonFile<{ items?: { relPath: string; durationSeconds?: number }[]; generatedAt?: string }>(mediaIndexPath);
        
        if (!mediaIndex?.items) {
          return NextResponse.json({ success: false, message: "Could not read media-index.json" }, { status: 400 });
        }

        const validItems: typeof mediaIndex.items = [];
        let removedCount = 0;
        
        for (const item of mediaIndex.items) {
          const fullPath = path.join(mediaRoot, item.relPath);
          if (await fileExists(fullPath)) {
            validItems.push(item);
          } else {
            removedCount++;
          }
        }

        if (removedCount === 0) {
          return NextResponse.json({ success: true, message: "No stale entries found" });
        }

        const cleanedIndex = {
          ...mediaIndex,
          items: validItems,
          generatedAt: new Date().toISOString(),
        };
        await fs.writeFile(mediaIndexPath, JSON.stringify(cleanedIndex, null, 2));
        
        return NextResponse.json({ 
          success: true, 
          message: `Removed ${removedCount} stale entries from media-index.json`
        });
      }

      case "clean-metadata": {
        const metadataPath = path.join(dataFolder, "media-metadata.json");
        const mediaIndexPath = path.join(dataFolder, "media-index.json");
        
        const metadata = await readJsonFile<Record<string, unknown>>(metadataPath);
        const mediaIndex = await readJsonFile<{ items?: { relPath: string }[] }>(mediaIndexPath);
        
        if (!metadata || !mediaIndex?.items) {
          return NextResponse.json({ success: false, message: "Could not read files" }, { status: 400 });
        }

        const indexPaths = new Set(mediaIndex.items.map(i => i.relPath));
        const cleanedMetadata: Record<string, unknown> = {};
        let removed = 0;
        
        for (const [key, value] of Object.entries(metadata)) {
          if (indexPaths.has(key)) {
            cleanedMetadata[key] = value;
          } else {
            removed++;
          }
        }

        await fs.writeFile(metadataPath, JSON.stringify(cleanedMetadata, null, 2));
        return NextResponse.json({ success: true, message: `Removed ${removed} orphaned metadata entries` });
      }

      default:
        return NextResponse.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
