import { execFile } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { Client, FileInfo } from "basic-ftp";
import fs from "node:fs/promises";
import ffprobe from "ffprobe-static";

const execFileAsync = promisify(execFile);

type FileResult = {
  file: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  probeSuccess: boolean;
  probeError?: string;
  wasReprobed?: boolean;
  wasCached?: boolean;
};

type ScanResult = {
  success: boolean;
  message: string;
  remotePath?: string;
  count?: number;
  files?: string[];
  fileResults?: FileResult[];
  stats?: {
    total: number;
    withDuration: number;
    zeroDuration: number;
    probeSuccessCount: number;
    probeFailCount: number;
    reprobedCount: number;
    fixedCount: number;
    cachedCount: number;
  };
};

type MediaItem = {
  relPath: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  title: string;
  audioCodec?: string;
};

const ALLOWED_EXTENSIONS = [".mp4", ".mkv", ".mov", ".avi", ".m4v", ".webm"];
const BROWSER_FRIENDLY_FORMATS = ["mp4", "webm", "m4v"];
const REMOTE_MEDIA_BASE = process.env.REMOTE_MEDIA_BASE || "https://chrismeisner.com/media/";

function getEnv() {
  const host = process.env.FTP_HOST?.trim();
  const user = process.env.FTP_USER?.trim();
  const password = process.env.FTP_PASS?.trim();
  const portRaw = process.env.FTP_PORT?.trim();
  const remotePath = process.env.FTP_REMOTE_PATH?.trim();
  const secureRaw = process.env.FTP_SECURE?.trim()?.toLowerCase();
  const port = portRaw ? Number(portRaw) : 21;
  const secure = secureRaw === "true" || secureRaw === "1";
  return { host, user, password, port, remotePath, secure };
}

function isMediaFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

function getFormat(filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return ext || "unknown";
}

function isSupported(format: string): boolean {
  return BROWSER_FRIENDLY_FORMATS.includes(format);
}

function getTitle(filename: string): string {
  return path.basename(filename, path.extname(filename));
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

  const common = [
    "/opt/homebrew/bin/ffprobe",       // macOS Homebrew
    "/usr/local/bin/ffprobe",          // macOS/Linux manual install
    "/usr/bin/ffprobe",                // Linux system install
    "/app/vendor/ffmpeg/ffprobe",      // Heroku buildpack location
  ];
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

type ProbeResult = {
  durationSeconds: number;
  success: boolean;
  error?: string;
};

async function probeRemoteDuration(url: string): Promise<ProbeResult> {
  try {
    const ffprobePath = await resolveFfprobePath();
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      url,
    ], { timeout: 30000 }); // 30 second timeout per file

    const parsed = JSON.parse(stdout);
    const duration = extractDurationSeconds(parsed);

    if (duration !== null && Number.isFinite(duration) && duration > 0) {
      return { durationSeconds: duration, success: true };
    }
    return { durationSeconds: 0, success: false, error: "No duration found in metadata" };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.warn("ffprobe failed for remote URL", url, errMsg);
    return { durationSeconds: 0, success: false, error: errMsg };
  }
}

export const runtime = "nodejs";

export async function POST() {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Missing FTP env vars (FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH). Set these in your environment.",
      } satisfies ScanResult,
      { status: 400 },
    );
  }

  try {
    // Fetch existing remote media-index.json to get cached durations
    // This allows us to skip re-probing files that already have valid durations
    // while re-trying files that previously had 0 duration
    const existingDurations = new Map<string, number>();
    try {
      const manifestUrl = REMOTE_MEDIA_BASE.endsWith("/")
        ? `${REMOTE_MEDIA_BASE}media-index.json`
        : `${REMOTE_MEDIA_BASE}/media-index.json`;
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (res.ok) {
        const existingIndex = await res.json() as { items?: MediaItem[] };
        for (const item of existingIndex.items || []) {
          // Only cache durations that are > 0 (valid)
          // Files with 0 duration will be re-probed
          if (item.durationSeconds > 0) {
            existingDurations.set(item.relPath, item.durationSeconds);
          }
        }
        console.log(`Loaded ${existingDurations.size} existing durations from remote index`);
      }
    } catch (err) {
      console.warn("Could not fetch existing remote index, will probe all files:", err);
    }

    // Connect to FTP and list files
    const client = new Client(30000);
    let fileList: FileInfo[] = [];
    
    try {
      await client.access({ host, port, user, password, secure });
      
      // Navigate to the media directory (parent of remotePath which is media-index.json)
      const remoteDir = path.posix.dirname(remotePath);
      if (remoteDir && remoteDir !== ".") {
        await client.cd(remoteDir);
      }
      
      // List all files
      fileList = await client.list();
    } finally {
      client.close();
    }

    // Filter for media files and build items
    const mediaFiles = fileList.filter(
      (f) => f.isFile && isMediaFile(f.name)
    );

    // Build base URL for probing remote files
    const baseUrl = REMOTE_MEDIA_BASE.endsWith("/")
      ? REMOTE_MEDIA_BASE
      : REMOTE_MEDIA_BASE + "/";

    // Probe each file for duration (in parallel with concurrency limit)
    const items: MediaItem[] = [];
    const fileResults: FileResult[] = [];
    const CONCURRENCY = 3; // Limit concurrent ffprobe calls
    
    for (let i = 0; i < mediaFiles.length; i += CONCURRENCY) {
      const batch = mediaFiles.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (f) => {
          const format = getFormat(f.name);
          const supported = isSupported(format);
          
          // Check existing remote index for cached duration (only valid durations > 0 are cached)
          const cachedDuration = existingDurations.get(f.name);
          let durationSeconds = cachedDuration ?? 0;
          let probeSuccess = cachedDuration !== undefined && cachedDuration > 0;
          let probeError: string | undefined;
          let wasReprobed = false;
          
          // If no valid cached duration (new file or previously 0), probe the remote file
          if (durationSeconds === 0) {
            const fileUrl = baseUrl + encodeURIComponent(f.name);
            console.log(`Probing remote file: ${fileUrl}`);
            const probeResult = await probeRemoteDuration(fileUrl);
            durationSeconds = probeResult.durationSeconds;
            probeSuccess = probeResult.success;
            probeError = probeResult.error;
            wasReprobed = true;
          }
          
          // Record detailed file result
          fileResults.push({
            file: f.name,
            durationSeconds,
            format,
            supported,
            probeSuccess,
            probeError,
            wasReprobed,
            wasCached: cachedDuration !== undefined && cachedDuration > 0,
          });
          
          return {
            relPath: f.name,
            durationSeconds,
            format,
            supported,
            supportedViaCompanion: false,
            title: getTitle(f.name),
          };
        })
      );
      items.push(...batchResults);
    }
    
    // Calculate stats
    const reprobedFiles = fileResults.filter(r => r.wasReprobed);
    const fixedFiles = reprobedFiles.filter(r => r.probeSuccess && r.durationSeconds > 0);
    const cachedFiles = fileResults.filter(r => r.wasCached);
    
    const stats = {
      total: items.length,
      withDuration: items.filter(i => i.durationSeconds > 0).length,
      zeroDuration: items.filter(i => i.durationSeconds === 0).length,
      probeSuccessCount: fileResults.filter(r => r.probeSuccess).length,
      probeFailCount: fileResults.filter(r => !r.probeSuccess).length,
      reprobedCount: reprobedFiles.length,
      fixedCount: fixedFiles.length,
      cachedCount: cachedFiles.length,
    };

    // Sort by filename
    items.sort((a, b) => a.relPath.localeCompare(b.relPath));

    // Build the payload
    const payload = {
      generatedAt: new Date().toISOString(),
      items,
    };
    const body = JSON.stringify(payload, null, 2);

    // Upload new media-index.json to remote
    const uploadClient = new Client(15000);
    try {
      await uploadClient.access({ host, port, user, password, secure });
      const targetDir = path.posix.dirname(remotePath);
      if (targetDir && targetDir !== ".") {
        await uploadClient.ensureDir(targetDir);
      }
      const stream = Readable.from([body]);
      await uploadClient.uploadFrom(stream, remotePath);
    } finally {
      uploadClient.close();
    }

    return NextResponse.json({
      success: true,
      message: `Scanned remote folder and uploaded media-index.json with ${items.length} files`,
      remotePath,
      count: items.length,
      files: items.map((i) => i.relPath),
      fileResults,
      stats,
    } satisfies ScanResult);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Scan failed: ${msg}` } satisfies ScanResult,
      { status: 500 },
    );
  }
}

