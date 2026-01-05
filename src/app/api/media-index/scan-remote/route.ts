import { execFile } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { Client, FileInfo } from "basic-ftp";
import fs from "node:fs/promises";
import ffprobe from "ffprobe-static";
import { getLocalMediaIndexFilePath } from "@/lib/media";

const execFileAsync = promisify(execFile);

type ScanResult = {
  success: boolean;
  message: string;
  remotePath?: string;
  count?: number;
  files?: string[];
};

type MediaItem = {
  relPath: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  title: string;
};

const ALLOWED_EXTENSIONS = [".mp4", ".mkv", ".mov", ".avi", ".m4v", ".webm"];
const BROWSER_FRIENDLY_FORMATS = ["mp4", "webm", "m4v"];
const LOCAL_INDEX_PATH = getLocalMediaIndexFilePath();
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

async function probeRemoteDuration(url: string): Promise<number> {
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
      return duration;
    }
  } catch (error) {
    console.warn("ffprobe failed for remote URL", url, error);
  }

  return 0;
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
    // Try to load local index to get durations for matching files
    let localIndex: { items?: MediaItem[] } = { items: [] };
    try {
      const raw = await fs.readFile(LOCAL_INDEX_PATH, "utf8");
      localIndex = JSON.parse(raw);
    } catch {
      // No local index, will use 0 for durations
    }
    const localDurations = new Map<string, number>();
    for (const item of localIndex.items || []) {
      localDurations.set(item.relPath, item.durationSeconds);
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
    const CONCURRENCY = 3; // Limit concurrent ffprobe calls
    
    for (let i = 0; i < mediaFiles.length; i += CONCURRENCY) {
      const batch = mediaFiles.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (f) => {
          const format = getFormat(f.name);
          const supported = isSupported(format);
          
          // First check local index for cached duration
          let durationSeconds = localDurations.get(f.name) || 0;
          
          // If no cached duration, probe the remote file
          if (durationSeconds === 0) {
            const fileUrl = baseUrl + encodeURIComponent(f.name);
            console.log(`Probing remote file: ${fileUrl}`);
            durationSeconds = await probeRemoteDuration(fileUrl);
          }
          
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
    } satisfies ScanResult);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Scan failed: ${msg}` } satisfies ScanResult,
      { status: 500 },
    );
  }
}

