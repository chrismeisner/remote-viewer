import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffprobe from "ffprobe-static";
import { REMOTE_MEDIA_BASE, type MediaSource } from "@/constants/media";
import {
  ChannelSchedule,
  DailySchedule,
  Schedule,
  ScheduleSlot,
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
  getDefaultMediaRoot,
} from "@/lib/config";

const execFileAsync = promisify(execFile);

// Default paths (used when no custom folder is set)
const DEFAULT_MEDIA_ROOT = path.resolve(path.join(process.cwd(), "media"));
const DEFAULT_DATA_ROOT = path.join(process.cwd(), "data", "local");

// Cached paths - updated when config changes
let cachedMediaRoot: string | null = null;
let cachedDataRoot: string | null = null;

/**
 * Get the current media root, checking config for custom folder.
 */
async function resolveMediaRoot(): Promise<string> {
  const config = await loadConfig();
  if (config.mediaRoot) {
    cachedMediaRoot = config.mediaRoot;
    return config.mediaRoot;
  }
  cachedMediaRoot = null;
  return getDefaultMediaRoot();
}

/**
 * Get the data folder path based on current config.
 * If custom folder is set: <mediaRoot>/.remote-viewer/
 * Otherwise: ./data/local/
 */
async function resolveDataRoot(): Promise<string> {
  const config = await loadConfig();
  if (config.mediaRoot) {
    const dataRoot = getDataFolderForMediaRoot(config.mediaRoot);
    cachedDataRoot = dataRoot;
    return dataRoot;
  }
  cachedDataRoot = null;
  return DEFAULT_DATA_ROOT;
}

// Dynamic path helpers
async function getScheduleFilePath(): Promise<string> {
  const dataRoot = await resolveDataRoot();
  return path.join(dataRoot, "schedule.json");
}

async function getChannelsFilePath(): Promise<string> {
  const dataRoot = await resolveDataRoot();
  return path.join(dataRoot, "channels.json");
}

async function getMediaIndexFilePath(): Promise<string> {
  const dataRoot = await resolveDataRoot();
  return path.join(dataRoot, "media-index.json");
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
  audioCodec?: string;
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
 * Get the media root path. Uses config if custom folder is set.
 * For sync access, returns cached value or default.
 */
export function getMediaRoot(): string {
  // Return cached if available, otherwise default
  return cachedMediaRoot ?? DEFAULT_MEDIA_ROOT;
}

/**
 * Async version that checks config.
 */
export async function getMediaRootAsync(): Promise<string> {
  return resolveMediaRoot();
}

/**
 * Clear all caches - call when media root changes.
 */
export function clearMediaCaches(): void {
  scheduleCache.clear();
  durationCache.clear();
  localScheduleCache = { mtimeMs: null, schedule: null, path: null };
  cachedMediaRoot = null;
  cachedDataRoot = null;
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
  const scheduleFile = await getScheduleFilePath();
  try {
    const stat = await fs.stat(scheduleFile);
    // Check cache is for same path and same mtime
    if (
      localScheduleCache.path === scheduleFile &&
      localScheduleCache.mtimeMs === stat.mtimeMs &&
      localScheduleCache.schedule
    ) {
      return localScheduleCache.schedule;
    }

    const raw = await fs.readFile(scheduleFile, "utf8");
    const parsed = JSON.parse(raw) as Schedule;
    validateSchedule(parsed);
    localScheduleCache = { mtimeMs: stat.mtimeMs, schedule: parsed, path: scheduleFile };
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      // Return empty schedule if file doesn't exist
      return { channels: {} };
    }
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
  const scheduleFile = await getScheduleFilePath();
  validateSchedule(schedule);
  await fs.mkdir(path.dirname(scheduleFile), { recursive: true });
  await fs.writeFile(scheduleFile, JSON.stringify(schedule, null, 2), {
    encoding: "utf8",
  });
  localScheduleCache = { mtimeMs: null, schedule, path: scheduleFile };
  return schedule;
}

// Export path helpers for use by API routes (async versions)
export async function getLocalScheduleFilePath(): Promise<string> {
  return getScheduleFilePath();
}

export async function getLocalChannelsFilePath(): Promise<string> {
  return getChannelsFilePath();
}

export async function getLocalMediaIndexFilePath(): Promise<string> {
  return getMediaIndexFilePath();
}

// Save a channel's schedule (updates the full schedule file)
export async function saveSchedule(
  schedule: DailySchedule,
  channel?: string,
): Promise<DailySchedule> {
  const channelId = normalizeChannelId(channel);
  validateChannelSchedule(schedule, channelId);

  // Load existing schedule
  const fullSchedule = await loadLocalFullSchedule();

  // Update the channel's schedule
  fullSchedule.channels[channelId] = { slots: schedule.slots };

  // Save back
  await saveFullSchedule(fullSchedule);

  return schedule;
}

export async function loadSchedule(
  channel?: string,
  source: MediaSource = "local",
): Promise<DailySchedule | null> {
  const channelId = normalizeChannelId(channel);
  const fullSchedule = await loadFullSchedule(source);
  const channelSchedule = fullSchedule.channels[channelId];
  
  if (!channelSchedule) {
    return null;
  }
  
  return { slots: channelSchedule.slots };
}

export type ChannelInfo = {
  id: string;
  shortName?: string;
};

export async function listChannels(source: MediaSource = "local"): Promise<ChannelInfo[]> {
  const fullSchedule = await loadFullSchedule(source);
  const channels: ChannelInfo[] = Object.entries(fullSchedule.channels).map(
    ([id, schedule]) => ({
      id,
      shortName: schedule.shortName,
    }),
  );
  return channels.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: "base" }),
  );
}

export async function createChannel(
  channel?: string,
  shortName?: string,
): Promise<{ channel: string; schedule: DailySchedule; shortName?: string }> {
  const id = normalizeChannelId(channel);

  // If it already exists, return the current schedule (or empty).
  const existing = await loadSchedule(id);
  if (existing) {
    const fullSchedule = await loadLocalFullSchedule();
    const existingShortName = fullSchedule.channels[id]?.shortName;
    return { channel: id, schedule: existing, shortName: existingShortName };
  }

  // Load full schedule and add new channel
  const fullSchedule = await loadLocalFullSchedule();
  const empty: ChannelSchedule = { slots: [], shortName: shortName?.trim() || undefined };
  fullSchedule.channels[id] = empty;
  await saveFullSchedule(fullSchedule);

  return { channel: id, schedule: { slots: [] }, shortName: shortName?.trim() || undefined };
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

export async function updateChannel(
  channel: string,
  updates: { shortName?: string },
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

  await saveFullSchedule(fullSchedule);

  return {
    id,
    shortName: fullSchedule.channels[id].shortName,
  };
}

async function getScheduledNowPlaying(
  now: number,
  channel?: string,
  source: MediaSource = "local",
): Promise<NowPlaying | null> {
  const schedule = await loadSchedule(channel, source);
  if (!schedule) return null;

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
      audioCodec: probeInfo?.audioCodec,
    });
  }

  scheduleCache.set("master", { scannedAt: Date.now(), items });
  return items;
}

async function listMediaFiles(): Promise<MediaFile[]> {
  const mediaRoot = await resolveMediaRoot();
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

function normalizeChannelId(channel?: string): string {
  if (!channel) return "";
  const base = channel.trim();
  if (!base) return "";
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, "-");
  return safe;
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

