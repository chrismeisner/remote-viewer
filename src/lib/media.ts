import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffprobe from "ffprobe-static";
import { DEFAULT_CHANNEL } from "@/constants/channels";
import {
  DailySchedule,
  ScheduleSlot,
  parseTimeToSeconds,
  validateSchedule,
} from "@/lib/schedule";

const execFileAsync = promisify(execFile);

// Hard-coded to the local project's media folder (./media relative to cwd).
const MEDIA_ROOT = path.resolve(path.join(process.cwd(), "media"));
const SCHEDULE_DIR = path.join(process.cwd(), "data", "schedules");

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
const scheduleFileCache = new Map<
  string,
  { mtimeMs: number | null; schedule: DailySchedule | null; path: string | null }
>();

export function getMediaRoot(): string {
  return MEDIA_ROOT;
}

export function buildMediaUrl(relPath: string): string {
  return `/api/media?file=${encodeURIComponent(relPath)}`;
}

export async function getNowPlaying(
  now: number = Date.now(),
  channel?: string,
): Promise<NowPlaying> {
  const scheduled = await getScheduledNowPlaying(now, channel);
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

export async function saveSchedule(
  schedule: DailySchedule,
  channel?: string,
): Promise<DailySchedule> {
  const channelId = normalizeChannelId(channel);
  validateSchedule(schedule);
  const targetPath = getPrimarySchedulePath(channelId);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(schedule, null, 2), {
    encoding: "utf8",
  });

  scheduleFileCache.set(channelId, { mtimeMs: null, schedule, path: targetPath });
  return schedule;
}

export async function loadSchedule(channel?: string): Promise<DailySchedule | null> {
  const channelId = normalizeChannelId(channel);
  const cached = scheduleFileCache.get(channelId);

  if (cached?.path) {
    try {
      const stat = await fs.stat(cached.path);
      if (cached.mtimeMs === stat.mtimeMs) {
        return cached.schedule;
      }
    } catch {
      // fall through to normal resolution
    }
  }

  const candidates = getScheduleFileCandidates(channelId);

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as DailySchedule;
      validateSchedule(parsed);
      scheduleFileCache.set(channelId, {
        mtimeMs: stat.mtimeMs,
        schedule: parsed,
        path: candidate,
      });
      return parsed;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  scheduleFileCache.set(channelId, { mtimeMs: null, schedule: null, path: null });
  return null;
}

export async function listChannels(): Promise<string[]> {
  const channels = new Set<string>([DEFAULT_CHANNEL]);

  // Ensure the baked-in default is present if any schedule file exists for it or legacy default.
  const defaultPaths = getScheduleFileCandidates(DEFAULT_CHANNEL);
  for (const p of defaultPaths) {
    if (await existsSafe(p)) {
      channels.add(DEFAULT_CHANNEL);
    }
  }

  if (await existsSafe(SCHEDULE_DIR)) {
    const entries = await fs.readdir(SCHEDULE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
        continue;
      }
      const name = path.basename(entry.name, ".json");
      const normalized = normalizeChannelId(name);
      if (normalized === "default") continue; // hide legacy default channel
      channels.add(normalized);
    }
  }

  return Array.from(channels).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export async function createChannel(
  channel?: string,
): Promise<{ channel: string; schedule: DailySchedule }> {
  const id = normalizeChannelId(channel);
  const targetPath = getPrimarySchedulePath(id);

  // If it already exists, return the current schedule (or empty).
  const existing = await loadSchedule(id);
  if (existing) {
    return { channel: id, schedule: existing };
  }

  const empty: DailySchedule = { slots: [] };
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(empty, null, 2), { encoding: "utf8" });
  scheduleFileCache.set(id, { mtimeMs: null, schedule: empty, path: targetPath });
  return { channel: id, schedule: empty };
}

export async function deleteChannel(channel?: string): Promise<void> {
  const id = normalizeChannelId(channel);
  if (id === "default") {
    throw new Error("Cannot delete default channel");
  }
  const targetPath = getPrimarySchedulePath(id);
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code !== "ENOENT") {
      throw error;
    }
  }
  scheduleFileCache.delete(id);
}

async function getScheduledNowPlaying(
  now: number,
  channel?: string,
): Promise<NowPlaying | null> {
  const schedule = await loadSchedule(channel);
  if (!schedule) return null;

  const files = await listMediaFiles();
  if (!files.length) return null;

  const filesWithDuration = await Promise.all(
    files.map(async (file) => ({
      ...file,
      durationSeconds: await getDurationSeconds(file.absPath, file.mtimeMs),
    })),
  );
  const fileMap = new Map(
    filesWithDuration.map((file) => [normalizeRel(file.relPath), file]),
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
  // Rough heuristic: containers and codecs commonly supported natively in browsers.
  // We only know the container here, so we err on the side of "no" for MKV/AVI.
  const ext = path.extname(relPath).toLowerCase();
  switch (ext) {
    case ".mp4":
    case ".m4v":
    case ".webm":
    case ".mov":
      return true;
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
  const base = (channel ?? DEFAULT_CHANNEL).trim() || DEFAULT_CHANNEL;
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, "-");
  return safe || DEFAULT_CHANNEL;
}

function getScheduleFileCandidates(channel: string): string[] {
  const id = normalizeChannelId(channel);
  if (id === DEFAULT_CHANNEL) {
    return [path.join(SCHEDULE_DIR, `${DEFAULT_CHANNEL}.json`)];
  }
  return [path.join(SCHEDULE_DIR, `${id}.json`)];
}

function getPrimarySchedulePath(channel: string): string {
  const id = normalizeChannelId(channel);
  if (id === DEFAULT_CHANNEL) {
    return path.join(SCHEDULE_DIR, `${DEFAULT_CHANNEL}.json`);
  }
  return path.join(SCHEDULE_DIR, `${id}.json`);
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
  const fmt = probeJson?.format;
  const streams = Array.isArray(probeJson?.streams) ? probeJson.streams : [];

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

