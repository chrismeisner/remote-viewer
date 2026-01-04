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
} from "@/lib/schedule";

const execFileAsync = promisify(execFile);

// Hard-coded to the local project's media folder (./media relative to cwd).
const MEDIA_ROOT = path.resolve(path.join(process.cwd(), "media"));
const SCHEDULE_FILE = path.join(process.cwd(), "data", "schedule.json");

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

export type ScheduledItem = {
  relPath: string;
  absPath: string;
  title: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
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
const durationCache = new Map<string, { durationSeconds: number; mtimeMs: number }>();

// Cache for the full schedule file
let localScheduleCache: {
  mtimeMs: number | null;
  schedule: Schedule | null;
} = { mtimeMs: null, schedule: null };

export function getMediaRoot(): string {
  return MEDIA_ROOT;
}

export function buildMediaUrl(relPath: string): string {
  return `/api/media?file=${encodeURIComponent(relPath)}`;
}

export async function getNowPlaying(
  now: number = Date.now(),
  channel?: string,
  source: MediaSource = "local",
): Promise<NowPlaying> {
  const scheduled = await getScheduledNowPlaying(now, channel, source);
  if (scheduled) return scheduled;
  throw new Error("Schedule has no playable media for now");
}

export async function resolveMediaPath(relPath: string): Promise<string> {
  const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absPath = path.join(MEDIA_ROOT, safeRel);

  if (!absPath.startsWith(MEDIA_ROOT)) {
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
  try {
    const stat = await fs.stat(SCHEDULE_FILE);
    if (localScheduleCache.mtimeMs === stat.mtimeMs && localScheduleCache.schedule) {
      return localScheduleCache.schedule;
    }

    const raw = await fs.readFile(SCHEDULE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Schedule;
    validateSchedule(parsed);
    localScheduleCache = { mtimeMs: stat.mtimeMs, schedule: parsed };
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
  validateSchedule(schedule);
  await fs.mkdir(path.dirname(SCHEDULE_FILE), { recursive: true });
  await fs.writeFile(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), {
    encoding: "utf8",
  });
  localScheduleCache = { mtimeMs: null, schedule };
  return schedule;
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

  const active = findActiveSlot(slots, zoned.secondsOfDay);
  if (active) {
    return buildNowPlaying(active, now, zoned.secondsOfDay, 0);
  }

  const upcoming = findNextSlot(slots, zoned.secondsOfDay, 0);
  if (upcoming) {
    return buildNowPlaying(
      upcoming.slot,
      now,
      zoned.secondsOfDay,
      upcoming.dayOffset,
    );
  }

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
  const companionSet = buildBrowserFriendlyBaseSet(mediaFiles);

  for (const file of mediaFiles) {
    const durationSeconds = await getDurationSeconds(file.absPath, file.mtimeMs);
    const supportedNative = isProbablyBrowserSupported(file.relPath);
    const supportedViaCompanion =
      !supportedNative && hasCompanionBrowserFile(file.relPath, companionSet);
    const supported = supportedNative || supportedViaCompanion;
    items.push({
      relPath: file.relPath,
      absPath: file.absPath,
      durationSeconds,
      format: formatFromPath(file.relPath),
      supported,
      supportedViaCompanion,
      title: titleFromPath(file.relPath),
    });
  }

  scheduleCache.set("master", { scannedAt: Date.now(), items });
  return items;
}

async function listMediaFiles(): Promise<MediaFile[]> {
  const exists = await existsSafe(MEDIA_ROOT);
  if (!exists) {
    return [];
  }

  const collected = await walkMediaFiles(MEDIA_ROOT, MEDIA_ROOT);
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
  const cached = durationCache.get(absPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.durationSeconds;
  }

  const durationSeconds = await probeDuration(absPath);
  durationCache.set(absPath, { durationSeconds, mtimeMs });
  return durationSeconds;
}

async function probeDuration(absPath: string): Promise<number> {
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

    if (duration !== null && Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  } catch (error) {
    console.warn("ffprobe failed", absPath, error);
  }

  console.warn("ffprobe missing duration, returning 0", absPath);
  return DURATION_FALLBACK_SECONDS;
}

function titleFromPath(relPath: string): string {
  const base = path.basename(relPath);
  return base.replace(path.extname(base), "");
}

function formatFromPath(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase().replace(/^\./, "");
  return ext || "unknown";
}

function isProbablyBrowserSupported(relPath: string): boolean {
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
  
  // Check if filename suggests HEVC/x265 codec (limited browser support)
  const isHevc = filename.includes("x265") || 
                 filename.includes("hevc") || 
                 filename.includes("h265") ||
                 filename.includes("h.265");
  
  // Check if filename suggests H.264/x264 codec (excellent browser support)
  const isH264 = filename.includes("x264") || 
                 filename.includes("h264") || 
                 filename.includes("h.264") ||
                 filename.includes("avc");
  
  switch (ext) {
    case ".mp4":
    case ".m4v":
      // MP4/M4V with H.264 = great support
      // MP4 with HEVC = limited (Safari only with hardware)
      return !isHevc;
    
    case ".webm":
      // WebM is well-supported (VP8/VP9 + Vorbis/Opus)
      return true;
    
    case ".mov":
      // QuickTime MOV with H.264 works well
      // MOV with HEVC/ProRes = limited
      return !isHevc;
    
    case ".mkv":
      // MKV is widely supported in Chrome/Firefox/Edge when containing H.264
      // MKV with HEVC = limited support
      // If we can't tell the codec, assume H.264 (most common) = likely works
      if (isHevc) return false;
      // If explicitly H.264, definitely works
      if (isH264) return true;
      // MKV without codec hints - most are H.264 and will play in Chrome/Firefox
      // Mark as supported since the player handles errors gracefully
      return true;
    
    case ".avi":
      // AVI files typically use legacy codecs (XviD, DivX, MPEG-4 Part 2)
      // These are NOT supported by browsers
      // Only rare AVI files with H.264 would work
      return isH264;
    
    case ".wmv":
    case ".asf":
    case ".flv":
      // Legacy formats - not supported
      return false;
    
    default:
      return false;
  }
}

function buildBrowserFriendlyBaseSet(files: MediaFile[]): Set<string> {
  const friendly = new Set<string>();
  for (const f of files) {
    if (isProbablyBrowserSupported(f.relPath)) {
      friendly.add(baseNameWithoutExt(f.relPath));
    }
  }
  return friendly;
}

function hasCompanionBrowserFile(relPath: string, friendlyBases: Set<string>) {
  const base = baseNameWithoutExt(relPath);
  return friendlyBases.has(base);
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
};

function resolveSlots(
  slots: ScheduleSlot[],
  fileMap: Map<string, MediaFile & { durationSeconds: number }>,
): ResolvedSlot[] {
  const normalized = slots
    .map((slot) => {
      const startSeconds = parseTimeToSeconds(slot.start);
      const endSeconds = parseTimeToSeconds(slot.end);
      if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
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
    const fallbackDuration = Math.max(1, slot.endSeconds - slot.startSeconds);
    const durationSeconds =
      typeof rawDurationSeconds === "number" && rawDurationSeconds > 0
        ? rawDurationSeconds
        : fallbackDuration;
    const windowSeconds = Math.max(
      1,
      Math.min(durationSeconds, slot.endSeconds - slot.startSeconds),
    );

    resolved.push({
      relPath: slot.relPath,
      title: slot.title || titleFromPath(slot.relPath),
      durationSeconds,
      startSeconds: slot.startSeconds,
      endSeconds: slot.endSeconds,
      windowSeconds,
      deltaSeconds: 0,
    });
  }

  return resolved;
}

function findActiveSlot(slots: ResolvedSlot[], secondsOfDay: number) {
  for (const slot of slots) {
    const startSeconds = slot.startSeconds;
    const endSeconds = startSeconds + slot.windowSeconds;
    if (secondsOfDay >= startSeconds && secondsOfDay < endSeconds) {
      const offsetSeconds = clampSeconds(
        secondsOfDay - startSeconds,
        0,
        slot.windowSeconds - 1,
      );
      return { ...slot, deltaMinutes: 0, offsetSeconds };
    }
  }
  return null;
}

function findNextSlot(
  slots: ResolvedSlot[],
  currentSeconds: number,
  dayOffset: number,
) {
  for (const slot of slots) {
    const deltaSeconds = dayOffset * 86400 + (slot.startSeconds - currentSeconds);
    if (deltaSeconds >= 0) {
      return {
        slot: { ...slot, deltaSeconds, offsetSeconds: 0 },
        dayOffset,
      };
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

