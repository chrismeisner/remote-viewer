import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffprobe from "ffprobe-static";
import { REMOTE_MEDIA_BASE, type MediaSource } from "@/constants/media";
import {
  ChannelSchedule,
  Schedule,
  ScheduleSlot,
  ScheduleType,
  PlaylistItem,
  parseTimeToSeconds,
  validateChannelSchedule,
  validateSchedule,
  slotDurationSeconds,
  effectiveEndSeconds,
} from "@/lib/schedule";
import {
  loadConfig,
  getEffectiveMediaRoot,
  getDataFolderForMediaRoot,
  hasMediaRootConfigured,
  getEffectiveCoversFolder,
} from "@/lib/config";
import { normalizeChannelId } from "@/lib/ftp";

const execFileAsync = promisify(execFile);

// Cached paths - updated when config changes
let cachedMediaRoot: string | null = null;
let cachedDataRoot: string | null = null;

/**
 * Get the current media root, checking config for custom folder.
 * Returns null if no folder is configured.
 */
async function resolveMediaRoot(): Promise<string | null> {
  const mediaRoot = await getEffectiveMediaRoot();
  cachedMediaRoot = mediaRoot;
  return mediaRoot;
}

/**
 * Get the data folder path based on current config.
 * Uses: <mediaRoot>/.remote-viewer/ if configured
 * Falls back to data/local/ when no media root is configured (e.g., remote/FTP mode).
 */
async function resolveDataRoot(): Promise<string | null> {
  // Reuse cached value when available (but only if non-null)
  if (cachedDataRoot) return cachedDataRoot;

  const mediaRoot = await getEffectiveMediaRoot();
  
  if (mediaRoot) {
    // Media root is configured - use it (no fallback)
    const dataRoot = getDataFolderForMediaRoot(mediaRoot);
    try {
      await fs.mkdir(dataRoot, { recursive: true });
      // Verify write access
      const testFile = path.join(dataRoot, ".write-test");
      await fs.writeFile(testFile, "test");
      await fs.unlink(testFile);
      cachedDataRoot = dataRoot;
      return dataRoot;
    } catch (error) {
      console.warn("Media data path is not writable:", error);
      // Fall back to data/local even if media root is configured but not writable
      // This handles the remote/FTP mode case
    }
  }

  // No media root configured or not writable - use local fallback
  // This allows metadata storage in remote/FTP mode
  const fallbackRoot = path.join(process.cwd(), "data", "local");
  try {
    await fs.mkdir(fallbackRoot, { recursive: true });
    cachedDataRoot = fallbackRoot;
    return fallbackRoot;
  } catch (error) {
    console.warn("Failed to create fallback data folder", error);
    return null;
  }
}

// Dynamic path helpers - return null if no folder configured
async function getScheduleFilePath(): Promise<string | null> {
  const dataRoot = await resolveDataRoot();
  if (!dataRoot) return null;
  return path.join(dataRoot, "schedule.json");
}

async function getMediaIndexFilePath(): Promise<string | null> {
  const dataRoot = await resolveDataRoot();
  if (!dataRoot) return null;
  return path.join(dataRoot, "media-index.json");
}

async function getMediaMetadataFilePath(): Promise<string | null> {
  const dataRoot = await resolveDataRoot();
  if (!dataRoot) return null;
  return path.join(dataRoot, "media-metadata.json");
}

async function getCoversFolderPath(): Promise<string> {
  return getEffectiveCoversFolder();
}

const ALLOWED_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".mov",
  ".avi",
  ".m4v",
  ".webm",
];

const SCAN_CACHE_MS = 60_000;
const DURATION_FALLBACK_SECONDS = 0;

type MediaFile = {
  relPath: string;
  absPath: string;
  mtimeMs: number;
};

type ProbeInfo = {
  durationSeconds: number;
  videoCodec?: string;
  audioCodec?: string;
  mtimeMs: number;
};

export type ScheduledItem = {
  relPath: string;
  absPath: string;
  title: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  videoCodec?: string;
  audioCodec?: string;
};

// Media metadata types
export type MediaType = "film" | "tv" | "documentary" | "sports" | "concert" | "other";

export type MediaMetadataItem = {
  title?: string | null;
  year?: number | null;
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: MediaType | null;
  season?: number | null;
  episode?: number | null;
  dateAdded?: string | null; // ISO date string when file was first added to library
  coverUrl?: string | null; // URL to external/uploaded cover image
  coverLocal?: string | null; // Filename of local cover in covers folder (for remote mode)
  coverPath?: string | null; // Full filesystem path to local image (for local mode)
};

export type MediaMetadataStore = {
  items: Record<string, MediaMetadataItem>;
};

export type NowPlaying = {
  title: string;
  relPath: string;
  durationSeconds: number;
  startOffsetSeconds: number;
  endsAt: number;
  src: string;
};

const scheduleCache = new Map<
  string,
  { scannedAt: number; items: ScheduledItem[] }
>();
const durationCache = new Map<string, ProbeInfo>();

// Cache for the full schedule file
let localScheduleCache: {
  mtimeMs: number | null;
  schedule: Schedule | null;
  path: string | null;
} = { mtimeMs: null, schedule: null, path: null };

/**
 * Get the media root path. Uses cached value.
 * Returns null if no folder is configured.
 */
export function getMediaRoot(): string | null {
  return cachedMediaRoot;
}

/**
 * Async version that checks config.
 * Returns null if no folder is configured.
 */
export async function getMediaRootAsync(): Promise<string | null> {
  return resolveMediaRoot();
}

/**
 * Check if a media folder is configured for local mode.
 */
export { hasMediaRootConfigured } from "@/lib/config";

/**
 * Clear all caches - call when media root changes.
 */
export function clearMediaCaches(): void {
  console.log("[Media Lib] clearMediaCaches called - clearing all caches");
  console.log("[Media Lib] Before clear - localScheduleCache:", {
    hasSchedule: !!localScheduleCache.schedule,
    path: localScheduleCache.path,
    channelCount: localScheduleCache.schedule ? Object.keys(localScheduleCache.schedule.channels || {}).length : 0,
  });
  scheduleCache.clear();
  durationCache.clear();
  localScheduleCache = { mtimeMs: null, schedule: null, path: null };
  cachedMediaRoot = null;
  cachedDataRoot = null;
  console.log("[Media Lib] After clear - caches reset to null/empty");
}

export function buildMediaUrl(relPath: string): string {
  return `/api/media?file=${encodeURIComponent(relPath)}`;
}

export async function getNowPlaying(
  now: number = Date.now(),
  channel?: string,
  source: MediaSource = "local",
): Promise<NowPlaying | null> {
  const scheduled = await getScheduledNowPlaying(now, channel, source);
  if (scheduled) return scheduled;
  return null;
}

export async function resolveMediaPath(relPath: string): Promise<string> {
  const mediaRoot = await resolveMediaRoot();
  
  if (!mediaRoot) {
    throw new Error("No media folder configured");
  }
  
  const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absPath = path.join(mediaRoot, safeRel);

  if (!absPath.startsWith(mediaRoot)) {
    throw new Error("Invalid media path");
  }

  const stat = await fs.stat(absPath);
  if (!stat.isFile()) {
    throw new Error("Media path is not a file");
  }

  if (!isAllowedExtension(absPath)) {
    throw new Error("Media file extension not allowed");
  }

  return absPath;
}

// Load the full schedule file
export async function loadFullSchedule(
  source: MediaSource = "local",
): Promise<Schedule> {
  if (source === "remote") {
    return loadRemoteFullSchedule();
  }
  return loadLocalFullSchedule();
}

async function loadLocalFullSchedule(): Promise<Schedule> {
  console.log("[Media Lib] loadLocalFullSchedule called");
  const scheduleFile = await getScheduleFilePath();
  
  console.log("[Media Lib] Schedule file path:", scheduleFile);
  
  // No folder configured - return empty schedule
  if (!scheduleFile) {
    console.log("[Media Lib] No schedule file path - returning empty schedule");
    return { channels: {} };
  }
  
  try {
    const stat = await fs.stat(scheduleFile);
    console.log("[Media Lib] File stat:", { 
      mtimeMs: stat.mtimeMs, 
      size: stat.size,
      path: scheduleFile 
    });
    
    // Check cache is for same path and same mtime
    const cacheHit = localScheduleCache.path === scheduleFile &&
      localScheduleCache.mtimeMs === stat.mtimeMs &&
      localScheduleCache.schedule;
    
    console.log("[Media Lib] Cache check:", {
      cacheHit,
      cachePath: localScheduleCache.path,
      cacheMtime: localScheduleCache.mtimeMs,
      fileMtime: stat.mtimeMs,
      cacheHasSchedule: !!localScheduleCache.schedule,
    });
    
    if (cacheHit) {
      const channelCount = Object.keys(localScheduleCache.schedule!.channels || {}).length;
      console.log("[Media Lib] RETURNING FROM CACHE - channels:", channelCount);
      return localScheduleCache.schedule!;
    }

    console.log("[Media Lib] Reading from disk:", scheduleFile);
    const raw = await fs.readFile(scheduleFile, "utf8");
    console.log("[Media Lib] Raw file contents (first 1000 chars):", raw.substring(0, 1000));
    
    const parsed = JSON.parse(raw) as Schedule;
    const channelCount = Object.keys(parsed.channels || {}).length;
    console.log("[Media Lib] Parsed schedule - channels:", channelCount, "ids:", Object.keys(parsed.channels || {}));
    
    // Log shortName for each channel to debug the issue
    for (const [cid, cdata] of Object.entries(parsed.channels || {})) {
      console.log("[Media Lib] Parsed channel data:", { id: cid, shortName: cdata.shortName, keys: Object.keys(cdata) });
    }
    
    validateSchedule(parsed);
    localScheduleCache = { mtimeMs: stat.mtimeMs, schedule: parsed, path: scheduleFile };
    console.log("[Media Lib] RETURNING FROM DISK - updated cache");
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      console.log("[Media Lib] File not found - returning empty schedule");
      return { channels: {} };
    }
    console.error("[Media Lib] Error loading schedule:", error);
    throw error;
  }
}

async function loadRemoteFullSchedule(): Promise<Schedule> {
  const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
  if (!base) return { channels: {} };

  try {
    const scheduleUrl = new URL("schedule.json", base).toString();
    const res = await fetch(scheduleUrl, { cache: "no-store" });
    if (!res.ok) {
      console.warn("Remote schedule.json not found", res.status);
      return { channels: {} };
    }
    const parsed = (await res.json()) as Schedule;
    validateSchedule(parsed);
    return parsed;
  } catch (error) {
    console.warn("Failed to fetch remote schedule", error);
    return { channels: {} };
  }
}

// Save the full schedule file
export async function saveFullSchedule(schedule: Schedule): Promise<Schedule> {
  console.log("[Media Lib] saveFullSchedule called");
  const scheduleFile = await getScheduleFilePath();
  
  console.log("[Media Lib] saveFullSchedule - target file:", scheduleFile);
  console.log("[Media Lib] saveFullSchedule - saving channels:", Object.keys(schedule.channels || {}));
  
  // Log each channel's data including shortName
  for (const [cid, cdata] of Object.entries(schedule.channels || {})) {
    console.log("[Media Lib] saveFullSchedule - channel data:", { id: cid, shortName: cdata.shortName, active: cdata.active, slotCount: cdata.slots?.length });
  }
  
  if (!scheduleFile) {
    throw new Error("Unable to save schedule: data folder is not accessible.");
  }
  
  validateSchedule(schedule);
  await fs.mkdir(path.dirname(scheduleFile), { recursive: true });
  
  const content = JSON.stringify(schedule, null, 2);
  console.log("[Media Lib] saveFullSchedule - writing content (first 1000 chars):", content.substring(0, 1000));
  
  await fs.writeFile(scheduleFile, content, {
    encoding: "utf8",
  });
  
  console.log("[Media Lib] saveFullSchedule - file written successfully");
  
  // Clear cache completely to ensure fresh reads
  localScheduleCache = { mtimeMs: null, schedule: null, path: null };
  console.log("[Media Lib] saveFullSchedule - cache cleared");
  return schedule;
}

// Export path helpers for use by API routes (async versions)
// Returns null if no folder configured
export async function getLocalScheduleFilePath(): Promise<string | null> {
  return getScheduleFilePath();
}

export async function getLocalMediaIndexFilePath(): Promise<string | null> {
  return getMediaIndexFilePath();
}

// Save a channel's schedule (updates the full schedule file)
export async function saveSchedule(
  schedule: ChannelSchedule,
  channel?: string,
): Promise<ChannelSchedule> {
  const channelId = normalizeChannelId(channel);
  validateChannelSchedule(schedule, channelId);

  // Load existing schedule
  const fullSchedule = await loadLocalFullSchedule();

  // Update the channel's schedule - preserve existing shortName, active, etc.
  const existingChannel = fullSchedule.channels[channelId] || {};
  const scheduleType: ScheduleType = schedule.type || existingChannel.type || "24hour";
  
  if (scheduleType === "looping") {
    fullSchedule.channels[channelId] = {
      ...existingChannel,
      type: "looping",
      playlist: schedule.playlist,
      // Clear slots for looping channels
      slots: undefined,
    };
  } else {
    fullSchedule.channels[channelId] = {
      ...existingChannel,
      type: "24hour",
      slots: schedule.slots,
      // Clear playlist for 24hour channels
      playlist: undefined,
    };
  }

  // Save back
  await saveFullSchedule(fullSchedule);

  return schedule;
}

export async function loadSchedule(
  channel?: string,
  source: MediaSource = "local",
): Promise<ChannelSchedule | null> {
  const channelId = normalizeChannelId(channel);
  const fullSchedule = await loadFullSchedule(source);
  const channelSchedule = fullSchedule.channels[channelId];
  
  if (!channelSchedule) {
    return null;
  }
  
  // Return full channel schedule including type and playlist for looping channels
  return {
    type: channelSchedule.type,
    slots: channelSchedule.slots,
    playlist: channelSchedule.playlist,
    shortName: channelSchedule.shortName,
    active: channelSchedule.active,
  };
}

export type ChannelInfo = {
  id: string;
  shortName?: string;
  active?: boolean; // Default true if undefined
  scheduledCount?: number; // Number of scheduled items in this channel
  type?: ScheduleType; // "24hour" (default) or "looping"
};

export async function listChannels(source: MediaSource = "local"): Promise<ChannelInfo[]> {
  console.log("[Media Lib] listChannels called", { source });
  const fullSchedule = await loadFullSchedule(source);
  console.log("[Media Lib] listChannels - fullSchedule loaded, channel keys:", Object.keys(fullSchedule.channels || {}));

  const channels: ChannelInfo[] = Object.entries(fullSchedule.channels).map(
    ([id, schedule]) => {
      const scheduleType: ScheduleType = schedule.type || "24hour";
      // Count items based on schedule type
      const scheduledCount = scheduleType === "looping"
        ? schedule.playlist?.length ?? 0
        : schedule.slots?.length ?? 0;
      
      console.log("[Media Lib] listChannels - processing channel:", {
        id,
        shortName: schedule.shortName,
        type: scheduleType,
        hasShortName: "shortName" in schedule,
        scheduleKeys: Object.keys(schedule),
        scheduledCount,
      });
      return {
        id,
        shortName: schedule.shortName,
        active: schedule.active ?? true, // Default to active if not set
        scheduledCount,
        type: scheduleType,
      };
    },
  );
  console.log("[Media Lib] listChannels - returning", channels.length, "channels with data:", channels);
  // Sort numerically when IDs are numbers, otherwise alphabetically
  return channels.sort((a, b) => {
    const aNum = parseInt(a.id, 10);
    const bNum = parseInt(b.id, 10);
    // If both are valid numbers, sort numerically
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum;
    }
    // Otherwise fall back to string comparison
    return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
  });
}

/**
 * List only active channels.
 */
export async function listActiveChannels(source: MediaSource = "local"): Promise<ChannelInfo[]> {
  const channels = await listChannels(source);
  return channels.filter((ch) => ch.active !== false);
}

export async function createChannel(
  channel?: string,
  shortName?: string,
  type?: ScheduleType,
): Promise<{ channel: string; schedule: ChannelSchedule; shortName?: string; type?: ScheduleType }> {
  console.log("[Media Lib] createChannel called", { channel, shortName, type });
  const id = normalizeChannelId(channel);
  const scheduleType: ScheduleType = type || "24hour";

  // If it already exists, return the current schedule (or empty).
  const existing = await loadSchedule(id);
  if (existing) {
    const fullSchedule = await loadLocalFullSchedule();
    const existingChannel = fullSchedule.channels[id];
    console.log("[Media Lib] createChannel - channel exists, returning existing:", { 
      id, 
      existingShortName: existingChannel?.shortName,
      existingType: existingChannel?.type,
    });
    return { 
      channel: id, 
      schedule: existing, 
      shortName: existingChannel?.shortName,
      type: existingChannel?.type || "24hour",
    };
  }

  // Load full schedule and add new channel
  const fullSchedule = await loadLocalFullSchedule();
  const newChannelData: ChannelSchedule = scheduleType === "looping"
    ? { type: "looping", playlist: [], shortName: shortName?.trim() || undefined }
    : { type: "24hour", slots: [], shortName: shortName?.trim() || undefined };
  
  console.log("[Media Lib] createChannel - creating new channel:", { id, newChannelData });
  fullSchedule.channels[id] = newChannelData;
  
  console.log("[Media Lib] createChannel - saving fullSchedule with channels:", 
    Object.entries(fullSchedule.channels).map(([cid, data]) => ({ id: cid, shortName: data.shortName, type: data.type }))
  );
  await saveFullSchedule(fullSchedule);

  return { 
    channel: id, 
    schedule: newChannelData, 
    shortName: shortName?.trim() || undefined,
    type: scheduleType,
  };
}

export async function deleteChannel(channel?: string): Promise<void> {
  const id = normalizeChannelId(channel);
  if (!id) {
    throw new Error("Channel ID is required");
  }

  // Load full schedule and remove channel
  const fullSchedule = await loadLocalFullSchedule();
  if (fullSchedule.channels[id]) {
    delete fullSchedule.channels[id];
    await saveFullSchedule(fullSchedule);
  }
}

export async function renameChannel(oldId: string, newId: string): Promise<void> {
  const oldNormalized = normalizeChannelId(oldId);
  const newNormalized = normalizeChannelId(newId);
  
  if (!oldNormalized || !newNormalized) {
    throw new Error("Both old and new channel IDs are required");
  }
  
  if (oldNormalized === newNormalized) {
    return; // No change needed
  }

  const fullSchedule = await loadLocalFullSchedule();
  
  if (!fullSchedule.channels[oldNormalized]) {
    throw new Error(`Channel "${oldNormalized}" not found`);
  }
  
  if (fullSchedule.channels[newNormalized]) {
    throw new Error(`Channel "${newNormalized}" already exists`);
  }

  // Move the channel data to the new ID
  fullSchedule.channels[newNormalized] = fullSchedule.channels[oldNormalized];
  delete fullSchedule.channels[oldNormalized];

  await saveFullSchedule(fullSchedule);
}

export async function updateChannel(
  channel: string,
  updates: { shortName?: string; active?: boolean },
): Promise<ChannelInfo> {
  const id = normalizeChannelId(channel);
  if (!id) {
    throw new Error("Channel ID is required");
  }

  const fullSchedule = await loadLocalFullSchedule();
  if (!fullSchedule.channels[id]) {
    throw new Error(`Channel "${id}" not found`);
  }

  // Update shortName (allow setting to empty string to remove it)
  if (updates.shortName !== undefined) {
    const trimmed = updates.shortName.trim();
    fullSchedule.channels[id].shortName = trimmed || undefined;
  }

  // Update active status
  if (updates.active !== undefined) {
    fullSchedule.channels[id].active = updates.active;
  }

  await saveFullSchedule(fullSchedule);

  return {
    id,
    shortName: fullSchedule.channels[id].shortName,
    active: fullSchedule.channels[id].active ?? true,
  };
}

async function getScheduledNowPlaying(
  now: number,
  channel?: string,
  source: MediaSource = "local",
): Promise<NowPlaying | null> {
  const schedule = await loadSchedule(channel, source);
  if (!schedule) return null;

  const scheduleType: ScheduleType = schedule.type || "24hour";

  // Branch based on schedule type
  if (scheduleType === "looping") {
    return getLoopingNowPlaying(schedule, now, source);
  }

  // Default: 24hour slot-based scheduling
  return get24HourNowPlaying(schedule, now, source);
}

async function get24HourNowPlaying(
  schedule: ChannelSchedule,
  now: number,
  source: MediaSource,
): Promise<NowPlaying | null> {
  // For remote source, always use remote media items; for local, use local files
  const fileEntries =
    source === "remote"
      ? await listRemoteMediaItems()
      : await getLocalMediaEntries();

  if (!fileEntries.length) return null;

  const fileMap = new Map(
    fileEntries.map((file) => [normalizeRel(file.relPath), file]),
  );

  const zoned = getLocalNow(now);
  const slots = resolveSlots(schedule.slots || [], fileMap);
  if (!slots.length) return null;

  // Only return content if there's an active slot right now.
  // If nothing is scheduled at this moment, return null (show blue screen).
  const active = findActiveSlot(slots, zoned.secondsOfDay);
  if (active) {
    return buildNowPlaying(active, now, zoned.secondsOfDay, 0);
  }

  // No active slot - show blue screen (return null)
  return null;
}

/**
 * Get now playing for a looping schedule.
 * The playlist loops infinitely based on epoch time.
 * Everyone watching sees the same thing at the same time.
 */
async function getLoopingNowPlaying(
  schedule: ChannelSchedule,
  now: number,
  source: MediaSource,
): Promise<NowPlaying | null> {
  const playlist = schedule.playlist;
  if (!playlist || playlist.length === 0) return null;

  // Calculate total playlist duration
  const totalDuration = playlist.reduce((sum, item) => sum + item.durationSeconds, 0);
  if (totalDuration <= 0) return null;

  // Get current position in the infinite loop based on epoch seconds
  const nowSeconds = Math.floor(now / 1000);
  const positionInLoop = nowSeconds % totalDuration;

  // Find which item is playing and at what offset
  let accumulated = 0;
  for (const item of playlist) {
    if (positionInLoop < accumulated + item.durationSeconds) {
      const offsetSeconds = positionInLoop - accumulated;
      const remainingSeconds = item.durationSeconds - offsetSeconds;
      
      return {
        title: item.title || titleFromPath(item.file),
        relPath: item.file,
        durationSeconds: item.durationSeconds,
        startOffsetSeconds: offsetSeconds,
        endsAt: now + remainingSeconds * 1000,
        src: buildMediaUrl(item.file),
      };
    }
    accumulated += item.durationSeconds;
  }

  // Should never reach here, but just in case
  return null;
}

async function getLocalMediaEntries() {
  const files = await listMediaFiles();
  if (files.length === 0) return [];
  return Promise.all(
    files.map(async (file) => ({
      ...file,
      durationSeconds: await getDurationSeconds(file.absPath, file.mtimeMs),
    })),
  );
}

export async function getScheduleItems(options?: { refresh?: boolean }): Promise<ScheduledItem[]> {
  const cached = scheduleCache.get("master");
  if (!options?.refresh && cached && Date.now() - cached.scannedAt < SCAN_CACHE_MS) {
    return cached.items;
  }

  const mediaFiles = await listMediaFiles();
  const items: ScheduledItem[] = [];
  const probeInfos = new Map<string, ProbeInfo>();

  await Promise.all(
    mediaFiles.map(async (file) => {
      const info = await getProbeInfo(file.absPath, file.mtimeMs);
      probeInfos.set(file.relPath, info);
    }),
  );

  for (const file of mediaFiles) {
    const probeInfo = probeInfos.get(file.relPath);
    const durationSeconds = probeInfo?.durationSeconds ?? DURATION_FALLBACK_SECONDS;
    const supportedNative = isProbablyBrowserSupported(
      file.relPath,
      probeInfo?.videoCodec,
      probeInfo?.audioCodec,
    );
    const supportedViaCompanion = false;
    const supported = supportedNative;
    items.push({
      relPath: file.relPath,
      absPath: file.absPath,
      durationSeconds,
      format: formatFromPath(file.relPath),
      supported,
      supportedViaCompanion,
      title: titleFromPath(file.relPath),
      videoCodec: probeInfo?.videoCodec,
      audioCodec: probeInfo?.audioCodec,
    });
  }

  scheduleCache.set("master", { scannedAt: Date.now(), items });
  return items;
}

async function listMediaFiles(): Promise<MediaFile[]> {
  const mediaRoot = await resolveMediaRoot();
  
  // No folder configured
  if (!mediaRoot) {
    return [];
  }
  
  const exists = await existsSafe(mediaRoot);
  if (!exists) {
    return [];
  }

  const collected = await walkMediaFiles(mediaRoot, mediaRoot);
  collected.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return collected;
}

async function walkMediaFiles(
  baseRoot: string,
  currentDir: string,
): Promise<MediaFile[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: MediaFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await walkMediaFiles(baseRoot, absPath);
      files.push(...nested);
      continue;
    }

    if (!entry.isFile() || !isAllowedExtension(absPath)) continue;

    const stat = await fs.stat(absPath);
    files.push({
      absPath,
      relPath: path.relative(baseRoot, absPath),
      mtimeMs: stat.mtimeMs,
    });
  }

  return files;
}

function isAllowedExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

type RemoteMediaItem = {
  relPath: string;
  durationSeconds: number;
  format?: string;
  title?: string;
};

async function listRemoteMediaItems(): Promise<
  Array<RemoteMediaItem & { absPath: string; mtimeMs: number }>
> {
  const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
  if (!base) return [];

  try {
    const manifestUrl = new URL("media-index.json", base).toString();
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      console.warn("Remote manifest fetch failed", manifestUrl, res.status);
      return [];
    }
    const json = await res.json();
    const items = Array.isArray(json?.items) ? (json.items as RemoteMediaItem[]) : [];
    return items
      .filter((i) => typeof i?.relPath === "string")
      .map((i) => ({
        relPath: i.relPath,
        absPath: i.relPath,
        durationSeconds: Number(i.durationSeconds) || 0,
        format: i.format,
        title: i.title,
        mtimeMs: Date.now(),
      }));
  } catch (error) {
    console.warn("Remote manifest fetch failed", error);
    return [];
  }
}

async function getDurationSeconds(
  absPath: string,
  mtimeMs: number,
): Promise<number> {
  const info = await getProbeInfo(absPath, mtimeMs);
  return info.durationSeconds;
}

async function getProbeInfo(
  absPath: string,
  mtimeMs: number,
): Promise<ProbeInfo> {
  const cached = durationCache.get(absPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached;
  }

  const probed = await probeMediaInfo(absPath);
  const info: ProbeInfo = {
    durationSeconds:
      typeof probed.durationSeconds === "number" &&
      Number.isFinite(probed.durationSeconds) &&
      probed.durationSeconds > 0
        ? probed.durationSeconds
        : DURATION_FALLBACK_SECONDS,
    videoCodec: probed.videoCodec,
    audioCodec: probed.audioCodec,
    mtimeMs,
  };

  durationCache.set(absPath, info);
  return info;
}

async function probeMediaInfo(
  absPath: string,
): Promise<{ durationSeconds: number | null; videoCodec?: string; audioCodec?: string }> {
  try {
    const ffprobePath = await resolveFfprobePath();
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      absPath,
    ]);

    const parsed = JSON.parse(stdout);
    const duration = extractDurationSeconds(parsed);
    const { videoCodec, audioCodec } = extractCodecNames(parsed);

    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      console.warn("ffprobe missing duration, returning 0", absPath);
      return { durationSeconds: null, videoCodec, audioCodec };
    }

    return { durationSeconds: duration, videoCodec, audioCodec };
  } catch (error) {
    console.warn("ffprobe failed", absPath, error);
  }

  return { durationSeconds: null };
}

function titleFromPath(relPath: string): string {
  const base = path.basename(relPath);
  return base.replace(path.extname(base), "");
}

function formatFromPath(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase().replace(/^\./, "");
  return ext || "unknown";
}

function isProbablyBrowserSupported(
  relPath: string,
  videoCodec?: string,
  audioCodec?: string,
): boolean {
  // Determine browser support based on container and inferred codec.
  // Modern browsers (Chrome, Firefox, Edge) support:
  //   - H.264/AVC video + AAC/MP3 audio in MP4, M4V, MOV, MKV containers
  //   - VP8/VP9 video + Vorbis/Opus audio in WebM container
  //   - Safari has limited MKV support, but Chrome/Firefox handle it well
  //
  // NOT supported:
  //   - HEVC/H.265 (limited Safari-only support, requires hardware)
  //   - AVI with legacy codecs (XviD, DivX, MPEG-4 Part 2)
  //   - WMV/ASF, FLV, and other legacy formats
  
  const ext = path.extname(relPath).toLowerCase();
  const filename = relPath.toLowerCase();
  const codec = (videoCodec || "").toLowerCase();
  // audioCodec reserved for future use; keep signature for potential follow-on checks
  void audioCodec;
  
  // Check if filename suggests HEVC/x265 codec (limited browser support)
  const nameHevc = filename.includes("x265") ||
                   filename.includes("hevc") ||
                   filename.includes("h265") ||
                   filename.includes("h.265");
  
  // Check if filename suggests H.264/x264 codec (excellent browser support)
  const nameH264 = filename.includes("x264") ||
                   filename.includes("h264") ||
                   filename.includes("h.264") ||
                   filename.includes("avc");

  // Prefer actual codec from ffprobe; fall back to filename hints
  const videoIsHevc =
    codec.includes("hevc") || codec.includes("h265") || codec.includes("h.265");
  const videoIsAvc = codec.includes("h264") || codec.includes("avc");
  const videoIsVp8 = codec.includes("vp8");
  const videoIsVp9 = codec.includes("vp9");

  const hevcLikely = videoIsHevc || (!codec && nameHevc);
  const avcLikely = videoIsAvc || (!codec && nameH264);
  
  switch (ext) {
    case ".mp4":
    case ".m4v":
      // MP4/M4V with H.264 = great support
      // MP4 with HEVC = limited (Safari only with hardware)
      if (videoIsAvc || videoIsVp8 || videoIsVp9) return true;
      if (hevcLikely) return false;
      return true;
    
    case ".webm":
      // WebM is well-supported (VP8/VP9 + Vorbis/Opus)
      if (videoIsVp8 || videoIsVp9) return true;
      if (videoIsAvc) return true;
      if (hevcLikely) return false;
      return true;
    
    case ".mov":
      // QuickTime MOV with H.264 works well
      // MOV with HEVC/ProRes = limited
      if (videoIsAvc || videoIsVp8 || videoIsVp9) return true;
      if (hevcLikely) return false;
      return true;
    
    case ".mkv":
      // MKV is widely supported in Chrome/Firefox/Edge when containing H.264
      // MKV with HEVC = limited support
      // If we can't tell the codec, assume H.264 (most common) = likely works
      if (hevcLikely) return false;
      if (videoIsAvc || videoIsVp8 || videoIsVp9 || avcLikely) return true;
      // MKV without codec hints - most are H.264 and will play in Chrome/Firefox
      // Mark as supported since the player handles errors gracefully
      return true;
    
    case ".avi":
      // AVI files typically use legacy codecs (XviD, DivX, MPEG-4 Part 2)
      // These are NOT supported by browsers
      // Only rare AVI files with H.264 would work
      if (videoIsAvc || avcLikely) return true;
      return false;
    
    case ".wmv":
    case ".asf":
    case ".flv":
      // Legacy formats - not supported
      return false;
    
    default:
      return false;
  }
}

function baseNameWithoutExt(relPath: string): string {
  const base = path.basename(relPath);
  return base.replace(path.extname(base), "");
}

async function existsSafe(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export function createMediaStream(
  absPath: string,
  start?: number,
  end?: number,
) {
  return createReadStream(absPath, start !== undefined ? { start, end } : {});
}

type ResolvedSlot = {
  relPath: string;
  title: string;
  durationSeconds: number;
  startSeconds: number;
  endSeconds: number;
  windowSeconds: number;
  deltaSeconds: number;
  offsetSeconds?: number;
  crossesMidnight: boolean;
};

function resolveSlots(
  slots: ScheduleSlot[],
  fileMap: Map<string, MediaFile & { durationSeconds: number }>,
): ResolvedSlot[] {
  const normalized = slots
    .map((slot) => {
      const startSeconds = parseTimeToSeconds(slot.start);
      const endSeconds = parseTimeToSeconds(slot.end);
      // Only reject if both are null or they are equal (zero duration)
      if (startSeconds === null || endSeconds === null || startSeconds === endSeconds) {
        return null;
      }
      return {
        ...slot,
        relPath: normalizeRel(slot.file),
        startSeconds,
        endSeconds,
      };
    })
    .filter(Boolean) as Array<
    ScheduleSlot & { relPath: string; startSeconds: number; endSeconds: number }
  >;

  normalized.sort((a, b) => a.startSeconds - b.startSeconds);

  const resolved: ResolvedSlot[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const slot = normalized[i];
    const file = fileMap.get(slot.relPath);
    if (!file) continue;

    const rawDurationSeconds = file.durationSeconds;
    // Calculate slot window accounting for midnight crossover
    const slotWindow = slotDurationSeconds(slot.startSeconds, slot.endSeconds);
    const fallbackDuration = Math.max(1, slotWindow);
    const durationSeconds =
      typeof rawDurationSeconds === "number" && rawDurationSeconds > 0
        ? rawDurationSeconds
        : fallbackDuration;
    const windowSeconds = Math.max(
      1,
      Math.min(durationSeconds, slotWindow),
    );
    const crossesMidnight = slot.endSeconds < slot.startSeconds;

    resolved.push({
      relPath: slot.relPath,
      title: slot.title || titleFromPath(slot.relPath),
      durationSeconds,
      startSeconds: slot.startSeconds,
      endSeconds: slot.endSeconds,
      windowSeconds,
      deltaSeconds: 0,
      crossesMidnight,
    });
  }

  return resolved;
}

function findActiveSlot(slots: ResolvedSlot[], secondsOfDay: number) {
  for (const slot of slots) {
    const startSeconds = slot.startSeconds;
    // Calculate the effective end based on the window (may be less than scheduled end if video is shorter)
    const effectiveWindowEnd = slot.crossesMidnight
      ? (startSeconds + slot.windowSeconds) % 86400
      : startSeconds + slot.windowSeconds;

    let isActive = false;
    let offsetSeconds = 0;

    if (slot.crossesMidnight) {
      // Slot crosses midnight (e.g., 23:00 -> 01:00)
      // Active if: currentTime >= start OR currentTime < effectiveWindowEnd
      // But we need to respect the actual window duration
      const windowEndWrapped = (startSeconds + slot.windowSeconds) % 86400;
      const windowEndsNextDay = startSeconds + slot.windowSeconds >= 86400;
      
      if (windowEndsNextDay) {
        // Window extends into the next day
        // Active if: time >= start (same day) OR time < windowEndWrapped (next day portion)
        if (secondsOfDay >= startSeconds) {
          isActive = true;
          offsetSeconds = secondsOfDay - startSeconds;
        } else if (secondsOfDay < windowEndWrapped) {
          isActive = true;
          offsetSeconds = (86400 - startSeconds) + secondsOfDay;
        }
      } else {
        // Window ends before midnight even though slot end time is past midnight
        // This means the video is shorter than the slot
        if (secondsOfDay >= startSeconds && secondsOfDay < startSeconds + slot.windowSeconds) {
          isActive = true;
          offsetSeconds = secondsOfDay - startSeconds;
        }
      }
    } else {
      // Normal slot (doesn't cross midnight)
      if (secondsOfDay >= startSeconds && secondsOfDay < startSeconds + slot.windowSeconds) {
        isActive = true;
        offsetSeconds = secondsOfDay - startSeconds;
      }
    }

    if (isActive) {
      offsetSeconds = clampSeconds(offsetSeconds, 0, slot.windowSeconds - 1);
      return { ...slot, deltaMinutes: 0, offsetSeconds };
    }
  }
  return null;
}

function buildNowPlaying(
  slot: ResolvedSlot & { offsetSeconds?: number },
  now: number,
  currentSeconds: number,
  dayOffset: number,
): NowPlaying {
  const deltaSeconds =
    dayOffset * 86400 + (slot.startSeconds - currentSeconds);
  const secondsUntilStart = Math.max(0, deltaSeconds);
  const startOffsetSeconds = slot.offsetSeconds ?? 0;
  const remainingWindow = Math.max(
    1,
    Math.min(slot.windowSeconds, slot.durationSeconds) - startOffsetSeconds,
  );

  return {
    title: slot.title,
    relPath: slot.relPath,
    durationSeconds: slot.durationSeconds,
    startOffsetSeconds,
    endsAt: now + (secondsUntilStart + remainingWindow) * 1000,
    src: buildMediaUrl(slot.relPath),
  };
}

function clampSeconds(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeRel(rel: string): string {
  return path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
}

function getLocalNow(now: number) {
  const d = new Date(now);
  const minutesOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  const secondsOfDay = minutesOfDay * 60 + d.getUTCSeconds();

  return {
    dayIndex: 0,
    minutesOfDay,
    secondsOfDay,
  };
}

function extractDurationSeconds(probeJson: unknown): number | null {
  if (!probeJson || typeof probeJson !== "object") return null;
  const obj = probeJson as { format?: { duration?: unknown }; streams?: unknown };
  const fmt = obj.format;
  const streams = Array.isArray(obj.streams) ? obj.streams : [];

  const fromFormat = Number(fmt?.duration);
  if (Number.isFinite(fromFormat) && fromFormat > 0) {
    return Math.round(fromFormat);
  }

  for (const s of streams) {
    const streamDuration = Number(s?.duration);
    if (Number.isFinite(streamDuration) && streamDuration > 0) {
      return Math.round(streamDuration);
    }
    const nbFrames = Number(s?.nb_frames);
    const avgFps = typeof s?.avg_frame_rate === "string" ? parseFps(s.avg_frame_rate) : null;
    if (Number.isFinite(nbFrames) && avgFps && avgFps > 0) {
      const seconds = nbFrames / avgFps;
      if (seconds > 0) return Math.round(seconds);
    }
  }

  return null;
}

function extractCodecNames(probeJson: unknown): {
  videoCodec?: string;
  audioCodec?: string;
} {
  if (!probeJson || typeof probeJson !== "object") return {};
  const obj = probeJson as { streams?: unknown };
  const streams = Array.isArray(obj.streams) ? obj.streams : [];

  const videoStream = streams.find((s) => s?.codec_type === "video");
  const audioStream = streams.find((s) => s?.codec_type === "audio");

  return {
    videoCodec:
      typeof videoStream?.codec_name === "string"
        ? videoStream.codec_name
        : typeof videoStream?.codec_tag_string === "string"
          ? videoStream.codec_tag_string
          : undefined,
    audioCodec:
      typeof audioStream?.codec_name === "string"
        ? audioStream.codec_name
        : typeof audioStream?.codec_tag_string === "string"
          ? audioStream.codec_tag_string
          : undefined,
  };
}

function parseFps(value: string): number | null {
  if (!value || value === "0/0") return null;
  const parts = value.split("/");
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }
  const asNum = Number(value);
  return Number.isFinite(asNum) ? asNum : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Media Metadata Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract year from a filename using common patterns:
 * - (1999) - parentheses
 * - .1999. - dots
 * - [1999] - brackets
 * - 1999 - standalone 4-digit year (1920-2099)
 */
export function extractYearFromFilename(filename: string): number | null {
  // Try parentheses pattern first: (1999)
  const parenMatch = filename.match(/\((\d{4})\)/);
  if (parenMatch) {
    const year = parseInt(parenMatch[1], 10);
    if (year >= 1920 && year <= 2099) return year;
  }

  // Try dot pattern: .1999.
  const dotMatch = filename.match(/\.(\d{4})\./);
  if (dotMatch) {
    const year = parseInt(dotMatch[1], 10);
    if (year >= 1920 && year <= 2099) return year;
  }

  // Try bracket pattern: [1999]
  const bracketMatch = filename.match(/\[(\d{4})\]/);
  if (bracketMatch) {
    const year = parseInt(bracketMatch[1], 10);
    if (year >= 1920 && year <= 2099) return year;
  }

  // Try space-separated pattern: Movie Title 1999 followed by resolution or word boundary
  const spaceMatch = filename.match(/\s(\d{4})(?:\s|$|\.|\b)/);
  if (spaceMatch) {
    const year = parseInt(spaceMatch[1], 10);
    if (year >= 1920 && year <= 2099) return year;
  }

  return null;
}

/**
 * Load media metadata from the JSON file.
 */
export async function loadMediaMetadata(): Promise<MediaMetadataStore> {
  const metadataFile = await getMediaMetadataFilePath();
  
  if (!metadataFile) {
    return { items: {} };
  }
  
  try {
    const raw = await fs.readFile(metadataFile, "utf8");
    const parsed = JSON.parse(raw) as MediaMetadataStore;
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return { items: {} };
    }
    throw error;
  }
}

/**
 * Save media metadata to the JSON file.
 * Falls back to data/local/ when no media root is configured (remote/FTP mode).
 */
export async function saveMediaMetadata(metadata: MediaMetadataStore): Promise<void> {
  const metadataFile = await getMediaMetadataFilePath();
  
  if (!metadataFile) {
    throw new Error("Unable to save metadata: data folder is not accessible.");
  }
  
  await fs.mkdir(path.dirname(metadataFile), { recursive: true });
  await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), {
    encoding: "utf8",
  });
}

/**
 * Get metadata for a specific media item.
 * If no explicit metadata exists, attempts to extract year from filename.
 */
export async function getMediaItemMetadata(relPath: string): Promise<MediaMetadataItem> {
  const store = await loadMediaMetadata();
  const existing = store.items[relPath] || {};
  
  // If year is not set, try to extract from filename
  if (existing.year === undefined) {
    const extractedYear = extractYearFromFilename(relPath);
    return {
      ...existing,
      year: extractedYear,
    };
  }
  
  return existing;
}

/**
 * Update metadata for a specific media item.
 * Pass null to explicitly clear a field, undefined to leave unchanged.
 */
export async function updateMediaItemMetadata(
  relPath: string,
  updates: Partial<MediaMetadataItem>,
): Promise<MediaMetadataItem> {
  const store = await loadMediaMetadata();
  
  const existing = store.items[relPath] || {};
  const updated: MediaMetadataItem = { ...existing };
  
  // Apply updates (undefined means no change, null means clear)
  if (updates.title !== undefined) updated.title = updates.title;
  if (updates.year !== undefined) updated.year = updates.year;
  if (updates.director !== undefined) updated.director = updates.director;
  if (updates.category !== undefined) updated.category = updates.category;
  if (updates.makingOf !== undefined) updated.makingOf = updates.makingOf;
  if (updates.plot !== undefined) updated.plot = updates.plot;
  if (updates.type !== undefined) updated.type = updates.type;
  if (updates.season !== undefined) updated.season = updates.season;
  if (updates.episode !== undefined) updated.episode = updates.episode;
  if (updates.coverUrl !== undefined) updated.coverUrl = updates.coverUrl;
  if (updates.coverLocal !== undefined) updated.coverLocal = updates.coverLocal;
  if (updates.coverPath !== undefined) updated.coverPath = updates.coverPath;
  
  // Clean up null/undefined values for cleaner JSON
  const cleaned: MediaMetadataItem = {};
  if (updated.title != null) cleaned.title = updated.title;
  if (updated.year != null) cleaned.year = updated.year;
  if (updated.director != null) cleaned.director = updated.director;
  if (updated.category != null) cleaned.category = updated.category;
  if (updated.makingOf != null) cleaned.makingOf = updated.makingOf;
  if (updated.plot != null) cleaned.plot = updated.plot;
  if (updated.type != null) cleaned.type = updated.type;
  if (updated.season != null) cleaned.season = updated.season;
  if (updated.episode != null) cleaned.episode = updated.episode;
  if (updated.coverUrl != null) cleaned.coverUrl = updated.coverUrl;
  if (updated.coverLocal != null) cleaned.coverLocal = updated.coverLocal;
  if (updated.coverPath != null) cleaned.coverPath = updated.coverPath;
  
  // Only store if there's actual data
  if (Object.keys(cleaned).length > 0) {
    store.items[relPath] = cleaned;
  } else {
    delete store.items[relPath];
  }
  
  await saveMediaMetadata(store);
  return cleaned;
}

/**
 * Get path to metadata file for external use.
 */
export async function getLocalMediaMetadataFilePath(): Promise<string | null> {
  return getMediaMetadataFilePath();
}

// ─────────────────────────────────────────────────────────────────────────────
// FFprobe Functions
// ─────────────────────────────────────────────────────────────────────────────

async function resolveFfprobePath(): Promise<string> {
  const envPath = process.env.FFPROBE_PATH;
  if (envPath) {
    try {
      await fs.access(envPath);
      return envPath;
    } catch {
      console.warn("FFPROBE_PATH set but not accessible:", envPath);
    }
  }

  const candidate = ffprobe?.path;
  if (candidate) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      console.warn("Bundled ffprobe not found at", candidate);
    }
  }

  const common = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"];
  for (const c of common) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // continue
    }
  }

  return "ffprobe";
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover Image Functions
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/**
 * Get path to covers folder for external use.
 * Always returns a valid path (uses fallback for remote/FTP mode).
 */
export async function getLocalCoversFolderPath(): Promise<string> {
  return getCoversFolderPath();
}

/**
 * Ensure the covers folder exists.
 * Always returns a valid path (uses fallback for remote/FTP mode).
 */
export async function ensureCoversFolderExists(): Promise<string> {
  const coversFolder = await getCoversFolderPath();
  
  // This should always have a value now due to fallback in getEffectiveCoversFolder
  if (!coversFolder) {
    throw new Error("Unable to determine covers folder path");
  }
  
  try {
    await fs.mkdir(coversFolder, { recursive: true });
    return coversFolder;
  } catch (error) {
    throw new Error(`Failed to create covers folder: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * List all available cover images in the covers folder.
 */
export async function listCoverImages(): Promise<string[]> {
  const coversFolder = await getCoversFolderPath();
  
  try {
    const entries = await fs.readdir(coversFolder, { withFileTypes: true });
    const coverFiles = entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        const ext = path.extname(entry.name).toLowerCase();
        return ALLOWED_COVER_EXTENSIONS.includes(ext);
      })
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    
    return coverFiles;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Get the absolute path to a specific cover image.
 * Returns null if the file doesn't exist or is not a valid cover image.
 */
export async function getCoverImagePath(filename: string): Promise<string | null> {
  const coversFolder = await getCoversFolderPath();
  
  // Security: prevent path traversal
  const safeName = path.basename(filename);
  const ext = path.extname(safeName).toLowerCase();
  
  if (!ALLOWED_COVER_EXTENSIONS.includes(ext)) {
    return null;
  }
  
  const absPath = path.join(coversFolder, safeName);
  
  // Verify the path is still within the covers folder
  if (!absPath.startsWith(coversFolder)) {
    return null;
  }
  
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return null;
    return absPath;
  } catch {
    return null;
  }
}

/**
 * Save a cover image to the covers folder.
 * Returns the filename of the saved cover.
 */
export async function saveCoverImage(
  filename: string,
  data: Buffer,
): Promise<string> {
  const coversFolder = await ensureCoversFolderExists();
  
  // Security: use only the base filename and validate extension
  const safeName = path.basename(filename);
  const ext = path.extname(safeName).toLowerCase();
  
  if (!ALLOWED_COVER_EXTENSIONS.includes(ext)) {
    throw new Error(`Invalid cover image format. Allowed: ${ALLOWED_COVER_EXTENSIONS.join(", ")}`);
  }
  
  const absPath = path.join(coversFolder, safeName);
  
  // Verify the path is still within the covers folder
  if (!absPath.startsWith(coversFolder)) {
    throw new Error("Invalid filename");
  }
  
  await fs.writeFile(absPath, data);
  return safeName;
}

/**
 * Delete a cover image from the covers folder.
 */
export async function deleteCoverImage(filename: string): Promise<void> {
  const absPath = await getCoverImagePath(filename);
  if (!absPath) {
    throw new Error("Cover image not found");
  }
  
  await fs.unlink(absPath);
}

/**
 * Get the URL to serve a local cover image via the API.
 */
export function buildCoverUrl(filename: string): string {
  return `/api/covers/${encodeURIComponent(filename)}`;
}

/**
 * Resolve the effective cover URL for a media item.
 * Priority: coverUrl > coverPath (local filesystem) > coverLocal (covers folder) > null
 */
export function resolveCoverUrl(metadata: MediaMetadataItem): string | null {
  if (metadata.coverUrl) {
    return metadata.coverUrl;
  }
  if (metadata.coverPath) {
    return `/api/local-image?path=${encodeURIComponent(metadata.coverPath)}`;
  }
  if (metadata.coverLocal) {
    return buildCoverUrl(metadata.coverLocal);
  }
  return null;
}

