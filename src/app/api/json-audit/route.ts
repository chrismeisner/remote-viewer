import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getEffectiveMediaRoot, getDataFolderForMediaRoot } from "@/lib/config";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import { isFtpConfigured, uploadJsonToFtp } from "@/lib/ftp";

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
  }[];
  canFix: boolean; // Whether fixes are available for this mode
};

// ==================== HELPERS ====================

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
  const canFix = isFtpConfigured();

  // Files to check (schedule.json is source of truth, channels.json is derived)
  const remoteFiles = [
    { name: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json` },
    { name: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json` },
  ];

  for (const file of remoteFiles) {
    const result = await fetchRemoteJson<Record<string, unknown>>(file.url);
    files.push({
      name: file.name,
      exists: result.exists,
      url: file.url,
    });

    if (!result.exists) {
      issues.push({
        id: `missing-${file.name}`,
        file: file.name,
        severity: "error",
        title: `${file.name} not found`,
        description: result.error || "File does not exist. Use 'Initialize Missing' to create it.",
        fixable: canFix,
        fixAction: "initialize-missing",
      });
    }
  }

  // Check schedule.json structure
  const scheduleResult = await fetchRemoteJson<{ channels?: Record<string, { slots?: unknown[]; shortName?: string; active?: boolean }> }>(
    `${REMOTE_MEDIA_BASE}schedule.json`
  );
  
  if (scheduleResult.exists && scheduleResult.data?.channels) {
    let needsNormalization = false;
    for (const [channelId, channelData] of Object.entries(scheduleResult.data.channels)) {
      if (channelData.active === undefined) {
        needsNormalization = true;
        issues.push({
          id: `schedule-missing-active-${channelId}`,
          file: "schedule.json",
          severity: "warning",
          title: `Channel "${channelId}" missing 'active' field`,
          description: "Should have explicit active status.",
          fixable: canFix,
          fixAction: "normalize-schedule",
        });
      }
      if (!channelData.shortName) {
        issues.push({
          id: `schedule-missing-shortname-${channelId}`,
          file: "schedule.json",
          severity: "info",
          title: `Channel "${channelId}" has no shortName`,
          description: "Consider adding a short display name.",
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
        id: "media-missing-duration",
        file: "media-index.json",
        severity: "warning",
        title: `${missingDuration.length} files missing duration`,
        description: "Some media files don't have duration metadata.",
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

  return { success: true, mode: "remote", issues, summary, files, canFix };
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
        id: "no-folder",
        file: "config",
        severity: "error",
        title: "No media folder configured",
        description: "Configure a media folder in Source settings first.",
        fixable: false,
      }],
      summary: { total: 1, errors: 1, warnings: 0, info: 0, fixable: 0 },
      files: [],
      canFix: false,
    };
  }
  
  const dataFolder = getDataFolderForMediaRoot(mediaRoot);

  // Ensure data folder exists
  try {
    await fs.mkdir(dataFolder, { recursive: true });
  } catch {
    // Ignore
  }

  // Files to check
  const jsonFiles = [
    { name: "schedule.json", path: path.join(dataFolder, "schedule.json") },
    { name: "media-index.json", path: path.join(dataFolder, "media-index.json") },
  ];

  for (const file of jsonFiles) {
    const exists = await fileExists(file.path);
    files.push({
      name: file.name,
      exists,
      path: file.path,
    });

    if (!exists) {
      issues.push({
        id: `missing-${file.name}`,
        file: file.name,
        severity: "error",
        title: `${file.name} not found`,
        description: "File does not exist. Use 'Initialize Missing' to create it.",
        fixable: true,
        fixAction: "initialize-missing",
      });
    }
  }

  // Check for deprecated channels.json
  const channelsPath = path.join(dataFolder, "channels.json");
  if (await fileExists(channelsPath)) {
    files.push({ name: "channels.json", exists: true, path: channelsPath });
    issues.push({
      id: "channels-deprecated",
      file: "channels.json",
      severity: "warning",
      title: "Deprecated channels.json exists",
      description: "Channel data is now in schedule.json. This file can be deleted.",
      fixable: true,
      fixAction: "delete-deprecated",
    });
  }

  // Check schedule.json structure
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
            description: "Should have explicit active status.",
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
            description: "Consider adding a short display name.",
            fixable: false,
          });
        }
      }
    }
  }

  // Check media-index.json for stale entries
  const mediaIndexPath = path.join(dataFolder, "media-index.json");
  if (await fileExists(mediaIndexPath)) {
    const mediaIndex = await readJsonFile<{ items?: { relPath: string; durationSeconds?: number }[] }>(mediaIndexPath);
    
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
          id: "media-stale",
          file: "media-index.json",
          severity: "warning",
          title: `${staleCount} stale media entries`,
          description: `Found ${staleCount} file(s) that no longer exist on disk.`,
          fixable: true,
          fixAction: "clean-media-index",
        });
      }

      const missingDuration = mediaIndex.items.filter(i => !i.durationSeconds || i.durationSeconds <= 0);
      if (missingDuration.length > 0) {
        issues.push({
          id: "media-missing-duration",
          file: "media-index.json",
          severity: "warning",
          title: `${missingDuration.length} files missing duration`,
          description: "Re-scan media folder to probe files.",
          fixable: false,
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

  return { success: true, mode: "local", issues, summary, files, canFix: true };
}

// ==================== GET HANDLER ====================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") as "local" | "remote" | null;
    
    if (mode === "remote") {
      return NextResponse.json(await auditRemoteMode());
    } else if (mode === "local") {
      return NextResponse.json(await auditLocalMode());
    }
    
    // Default to local if configured, otherwise remote
    const mediaRoot = await getEffectiveMediaRoot();
    if (mediaRoot) {
      return NextResponse.json(await auditLocalMode());
    }
    return NextResponse.json(await auditRemoteMode());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, mode: "unknown", issues: [], summary: { total: 0, errors: 0, warnings: 0, info: 0, fixable: 0 }, files: [], canFix: false, error: msg },
      { status: 500 }
    );
  }
}

// ==================== POST HANDLER (fixes) ====================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, mode } = body as { action: string; mode?: "local" | "remote" };

    // Handle based on mode
    if (mode === "remote") {
      return await handleRemoteFix(action);
    } else {
      return await handleLocalFix(action);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

// ==================== REMOTE FIXES ====================
async function handleRemoteFix(action: string) {
  if (!isFtpConfigured()) {
    return NextResponse.json({ success: false, message: "FTP not configured" }, { status: 400 });
  }

  switch (action) {
    case "initialize-missing": {
      const actions: string[] = [];
      
      // Check and create schedule.json
      const scheduleResult = await fetchRemoteJson<unknown>(`${REMOTE_MEDIA_BASE}schedule.json`);
      if (!scheduleResult.exists) {
        await uploadJsonToFtp("schedule.json", { channels: {} });
        actions.push("Created schedule.json");
      }
      
      // Check and create media-index.json
      const mediaResult = await fetchRemoteJson<unknown>(`${REMOTE_MEDIA_BASE}media-index.json`);
      if (!mediaResult.exists) {
        await uploadJsonToFtp("media-index.json", { items: [], generatedAt: new Date().toISOString() });
        actions.push("Created media-index.json");
      }
      
      if (actions.length === 0) {
        return NextResponse.json({ success: true, message: "All files already exist" });
      }
      return NextResponse.json({ success: true, message: actions.join("; ") });
    }

    case "normalize-schedule": {
      // Fetch, normalize, push back
      const result = await fetchRemoteJson<{ channels: Record<string, { slots?: unknown[]; active?: boolean }> }>(
        `${REMOTE_MEDIA_BASE}schedule.json`
      );
      
      if (!result.exists || !result.data) {
        return NextResponse.json({ success: false, message: "Could not fetch schedule.json" }, { status: 400 });
      }
      
      let fixed = 0;
      for (const channelData of Object.values(result.data.channels)) {
        if (channelData.active === undefined) {
          channelData.active = true;
          fixed++;
        }
      }
      
      await uploadJsonToFtp("schedule.json", result.data);
      return NextResponse.json({ success: true, message: `Normalized ${fixed} channel(s)` });
    }

    case "fresh-start": {
      // Push clean files
      await uploadJsonToFtp("schedule.json", { channels: {} });
      await uploadJsonToFtp("media-index.json", { items: [], generatedAt: new Date().toISOString() });
      
      return NextResponse.json({ 
        success: true, 
        message: "Fresh start complete. Pushed empty schedule.json and media-index.json"
      });
    }

    default:
      return NextResponse.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });
  }
}

// ==================== LOCAL FIXES ====================
async function handleLocalFix(action: string) {
  const mediaRoot = await getEffectiveMediaRoot();
  if (!mediaRoot) {
    return NextResponse.json({ success: false, message: "No media folder configured" }, { status: 400 });
  }
  const dataFolder = getDataFolderForMediaRoot(mediaRoot);

  switch (action) {
    case "initialize-missing": {
      const actions: string[] = [];
      await fs.mkdir(dataFolder, { recursive: true });
      
      const schedulePath = path.join(dataFolder, "schedule.json");
      if (!(await fileExists(schedulePath))) {
        await fs.writeFile(schedulePath, JSON.stringify({ channels: {} }, null, 2));
        actions.push("Created schedule.json");
      }
      
      const mediaIndexPath = path.join(dataFolder, "media-index.json");
      if (!(await fileExists(mediaIndexPath))) {
        await fs.writeFile(mediaIndexPath, JSON.stringify({ items: [], generatedAt: new Date().toISOString() }, null, 2));
        actions.push("Created media-index.json");
      }
      
      if (actions.length === 0) {
        return NextResponse.json({ success: true, message: "All files already exist" });
      }
      return NextResponse.json({ success: true, message: actions.join("; ") });
    }

    case "normalize-schedule": {
      const schedulePath = path.join(dataFolder, "schedule.json");
      const schedule = await readJsonFile<{ channels: Record<string, { active?: boolean }> }>(schedulePath);
      
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
      return NextResponse.json({ success: true, message: `Normalized ${fixed} channel(s)` });
    }

    case "delete-deprecated": {
      const channelsPath = path.join(dataFolder, "channels.json");
      if (await fileExists(channelsPath)) {
        await fs.unlink(channelsPath);
        return NextResponse.json({ success: true, message: "Deleted deprecated channels.json" });
      }
      return NextResponse.json({ success: true, message: "File already deleted" });
    }

    case "clean-media-index": {
      const mediaIndexPath = path.join(dataFolder, "media-index.json");
      const mediaIndex = await readJsonFile<{ items?: { relPath: string }[]; generatedAt?: string }>(mediaIndexPath);
      
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

      await fs.writeFile(mediaIndexPath, JSON.stringify({
        ...mediaIndex,
        items: validItems,
        generatedAt: new Date().toISOString(),
      }, null, 2));
      
      return NextResponse.json({ success: true, message: `Removed ${removedCount} stale entries` });
    }

    case "fresh-start": {
      await fs.mkdir(dataFolder, { recursive: true });
      
      // Create clean files
      await fs.writeFile(path.join(dataFolder, "schedule.json"), JSON.stringify({ channels: {} }, null, 2));
      await fs.writeFile(path.join(dataFolder, "media-index.json"), JSON.stringify({ items: [], generatedAt: new Date().toISOString() }, null, 2));
      
      // Delete deprecated files
      const toDelete = ["channels.json", "media-metadata.json"];
      for (const file of toDelete) {
        const filePath = path.join(dataFolder, file);
        if (await fileExists(filePath)) {
          await fs.unlink(filePath);
        }
      }
      
      return NextResponse.json({ success: true, message: "Fresh start complete. Created clean files, removed deprecated ones." });
    }

    default:
      return NextResponse.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });
  }
}
