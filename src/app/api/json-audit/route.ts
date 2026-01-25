import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getEffectiveMediaRoot, getDataFolderForMediaRoot } from "@/lib/config";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import { isFtpConfigured, uploadJsonToFtp, ftpDirectoryExists, ensureFtpDirectory } from "@/lib/ftp";
import { clearMediaCaches } from "@/lib/media";

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

/**
 * Resolve the actual data folder - matches logic in media.ts
 * Falls back to data/local/ if configured mediaRoot is not writable
 */
async function resolveLocalDataFolder(): Promise<string | null> {
  const mediaRoot = await getEffectiveMediaRoot();
  
  if (mediaRoot) {
    const dataRoot = getDataFolderForMediaRoot(mediaRoot);
    try {
      await fs.mkdir(dataRoot, { recursive: true });
      // Test write access
      const testFile = path.join(dataRoot, ".write-test");
      await fs.writeFile(testFile, "test");
      await fs.unlink(testFile);
      return dataRoot;
    } catch {
      console.log("Media root not writable, falling back to data/local/");
    }
  }

  // Fallback to repository data folder
  const fallbackRoot = path.join(process.cwd(), "data", "local");
  try {
    await fs.mkdir(fallbackRoot, { recursive: true });
    return fallbackRoot;
  } catch {
    return null;
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
    // Add timestamp to bust CDN caches
    const cacheBustedUrl = url.includes("?") ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
    const res = await fetch(cacheBustedUrl, { cache: "no-store" });
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
  console.log("[JSON Audit] auditRemoteMode called");
  const issues: AuditIssue[] = [];
  const files: AuditResult["files"] = [];
  const canFix = isFtpConfigured();

  // Files to check
  const remoteFiles = [
    { name: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json` },
    { name: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json` },
    { name: "media-metadata.json", url: `${REMOTE_MEDIA_BASE}media-metadata.json` },
  ];
  console.log("[JSON Audit] Checking remote files at:", REMOTE_MEDIA_BASE);

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
  
  console.log("[JSON Audit] Remote schedule.json result:", {
    exists: scheduleResult.exists,
    channelCount: scheduleResult.data?.channels ? Object.keys(scheduleResult.data.channels).length : 0,
    channelIds: scheduleResult.data?.channels ? Object.keys(scheduleResult.data.channels) : [],
  });
  
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

  // Check for covers folder on FTP
  if (canFix) {
    try {
      const coversExists = await ftpDirectoryExists("covers");
      files.push({
        name: "covers/",
        exists: coversExists,
        url: `${REMOTE_MEDIA_BASE}covers/`,
      });
      
      if (!coversExists) {
        issues.push({
          id: "missing-covers-folder",
          file: "covers/",
          severity: "warning",
          title: "Covers folder not found",
          description: "The covers folder doesn't exist on the remote server. Create it to enable cover image uploads.",
          fixable: true,
          fixAction: "create-covers-folder",
        });
      }
    } catch (err) {
      console.error("[JSON Audit] Failed to check covers folder:", err);
      // Don't fail the audit if we can't check the covers folder
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
  console.log("[JSON Audit] auditLocalMode called");
  const issues: AuditIssue[] = [];
  const files: AuditResult["files"] = [];

  const dataFolder = await resolveLocalDataFolder();
  console.log("[JSON Audit] Local data folder:", dataFolder);

  if (!dataFolder) {
    return {
      success: false,
      mode: "local",
      issues: [{
        id: "no-folder",
        file: "config",
        severity: "error",
        title: "No data folder available",
        description: "Could not access or create a data folder.",
        fixable: false,
      }],
      summary: { total: 1, errors: 1, warnings: 0, info: 0, fixable: 0 },
      files: [],
      canFix: false,
    };
  }

  // Files to check
  const jsonFiles = [
    { name: "schedule.json", path: path.join(dataFolder, "schedule.json") },
    { name: "media-index.json", path: path.join(dataFolder, "media-index.json") },
    { name: "media-metadata.json", path: path.join(dataFolder, "media-metadata.json") },
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
    
    console.log("[JSON Audit] Local schedule.json:", {
      path: schedulePath,
      channelCount: schedule?.channels ? Object.keys(schedule.channels).length : 0,
      channelIds: schedule?.channels ? Object.keys(schedule.channels) : [],
    });
    
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
    const mediaRoot = await getEffectiveMediaRoot();
    
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

  // Check for local covers folder
  const coversPath = path.join(dataFolder, "covers");
  const coversExists = await fileExists(coversPath);
  files.push({
    name: "covers/",
    exists: coversExists,
    path: coversPath,
  });
  
  if (!coversExists) {
    issues.push({
      id: "missing-covers-folder",
      file: "covers/",
      severity: "info",
      title: "Covers folder not found",
      description: "The local covers folder doesn't exist. It will be created automatically when you upload a cover image.",
      fixable: true,
      fixAction: "create-covers-folder",
    });
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
    
    console.log("[JSON Audit API] GET request received", { mode });
    
    if (mode === "remote") {
      console.log("[JSON Audit API] Running remote audit");
      const result = await auditRemoteMode();
      console.log("[JSON Audit API] Remote audit result:", {
        mode: result.mode,
        issueCount: result.issues.length,
        channelIssues: result.issues.filter(i => i.file === "schedule.json").map(i => i.id),
      });
      return NextResponse.json(result);
    } else if (mode === "local") {
      console.log("[JSON Audit API] Running local audit");
      const result = await auditLocalMode();
      console.log("[JSON Audit API] Local audit result:", {
        mode: result.mode,
        issueCount: result.issues.length,
        channelIssues: result.issues.filter(i => i.file === "schedule.json").map(i => i.id),
      });
      return NextResponse.json(result);
    }
    
    // Default to local if configured, otherwise remote
    const mediaRoot = await getEffectiveMediaRoot();
    console.log("[JSON Audit API] No mode specified, defaulting based on mediaRoot:", { hasMediaRoot: !!mediaRoot });
    if (mediaRoot) {
      return NextResponse.json(await auditLocalMode());
    }
    return NextResponse.json(await auditRemoteMode());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[JSON Audit API] Error:", msg);
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
      
      // Check and create media-metadata.json
      const metadataResult = await fetchRemoteJson<unknown>(`${REMOTE_MEDIA_BASE}media-metadata.json`);
      if (!metadataResult.exists) {
        await uploadJsonToFtp("media-metadata.json", { items: {} });
        actions.push("Created media-metadata.json");
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

    case "create-covers-folder": {
      try {
        await ensureFtpDirectory("covers");
        return NextResponse.json({ success: true, message: "Created covers folder on remote server" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ success: false, message: `Failed to create covers folder: ${msg}` }, { status: 500 });
      }
    }

    case "fresh-start": {
      // Push clean files
      await uploadJsonToFtp("schedule.json", { channels: {} });
      await uploadJsonToFtp("media-index.json", { items: [], generatedAt: new Date().toISOString() });
      await uploadJsonToFtp("media-metadata.json", { items: {} });

      // Ensure covers folder exists
      try {
        await ensureFtpDirectory("covers");
      } catch (err) {
        console.warn("[Fresh Start] Could not create covers folder:", err);
      }

      // Clear caches
      clearMediaCaches();

      return NextResponse.json({
        success: true,
        message: "Fresh start complete. Pushed empty schedule.json, media-index.json, media-metadata.json, and created covers folder"
      });
    }

    default:
      return NextResponse.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });
  }
}

// ==================== LOCAL FIXES ====================
async function handleLocalFix(action: string) {
  const dataFolder = await resolveLocalDataFolder();
  if (!dataFolder) {
    return NextResponse.json({ success: false, message: "No data folder available" }, { status: 400 });
  }

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
      
      const metadataPath = path.join(dataFolder, "media-metadata.json");
      if (!(await fileExists(metadataPath))) {
        await fs.writeFile(metadataPath, JSON.stringify({ items: {} }, null, 2));
        actions.push("Created media-metadata.json");
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

      const mediaRoot = await getEffectiveMediaRoot();
      if (!mediaRoot) {
        return NextResponse.json({ success: false, message: "No media folder configured" }, { status: 400 });
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

    case "create-covers-folder": {
      const coversPath = path.join(dataFolder, "covers");
      try {
        await fs.mkdir(coversPath, { recursive: true });
        return NextResponse.json({ success: true, message: "Created covers folder" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ success: false, message: `Failed to create covers folder: ${msg}` }, { status: 500 });
      }
    }

    case "fresh-start": {
      await fs.mkdir(dataFolder, { recursive: true });

      // Create clean files
      await fs.writeFile(path.join(dataFolder, "schedule.json"), JSON.stringify({ channels: {} }, null, 2));
      await fs.writeFile(path.join(dataFolder, "media-index.json"), JSON.stringify({ items: [], generatedAt: new Date().toISOString() }, null, 2));
      await fs.writeFile(path.join(dataFolder, "media-metadata.json"), JSON.stringify({ items: {} }, null, 2));
      
      // Create covers folder
      await fs.mkdir(path.join(dataFolder, "covers"), { recursive: true });

      // Delete deprecated files
      const toDelete = ["channels.json"];
      for (const file of toDelete) {
        const filePath = path.join(dataFolder, file);
        if (await fileExists(filePath)) {
          await fs.unlink(filePath);
        }
      }

      // Clear media caches so next request reads fresh data
      clearMediaCaches();

      return NextResponse.json({ success: true, message: "Fresh start complete. Created clean files, removed deprecated ones." });
    }

    default:
      return NextResponse.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });
  }
}
