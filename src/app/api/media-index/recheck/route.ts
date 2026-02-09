import { execFile } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { Client } from "basic-ftp";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

type MediaItem = {
  relPath: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  title: string;
  videoCodec?: string;
  audioCodec?: string;
  size?: number;
  modifiedAt?: string;
  probeFailedAt?: string;
  dateAdded?: string;
};

type MediaIndex = {
  generatedAt: string;
  items: MediaItem[];
};

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
  // Priority 1: Environment variable (for explicit override)
  const envPath = process.env.FFPROBE_PATH;
  if (envPath) {
    try {
      await fs.access(envPath);
      return envPath;
    } catch {
      console.warn("FFPROBE_PATH set but not accessible:", envPath);
    }
  }

  // Priority 2: Common system paths (Heroku buildpack installs to /app/vendor/ffmpeg/bin/ffprobe)
  const common = [
    "/app/vendor/ffmpeg/bin/ffprobe",  // Heroku buildpack location
    "/usr/bin/ffprobe",                // Standard Linux location
    "/usr/local/bin/ffprobe",          // Common install location
    "/opt/homebrew/bin/ffprobe",       // macOS Homebrew (ARM)
  ];
  for (const c of common) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // continue
    }
  }

  // Priority 3: Try system PATH (fallback)
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

function extractCodecNames(probeJson: unknown): { videoCodec?: string; audioCodec?: string } {
  if (!probeJson || typeof probeJson !== "object") return {};
  const obj = probeJson as { streams?: unknown[] };
  const streams = Array.isArray(obj.streams) ? obj.streams : [];
  
  let videoCodec: string | undefined;
  let audioCodec: string | undefined;
  
  for (const stream of streams) {
    if (!stream || typeof stream !== "object") continue;
    const s = stream as { codec_type?: string; codec_name?: string };
    if (s.codec_type === "video" && !videoCodec && s.codec_name) {
      videoCodec = s.codec_name;
    }
    if (s.codec_type === "audio" && !audioCodec && s.codec_name) {
      audioCodec = s.codec_name;
    }
  }
  
  return { videoCodec, audioCodec };
}

type ProbeResult = {
  durationSeconds: number;
  videoCodec?: string;
  audioCodec?: string;
  success: boolean;
  error?: string;
};

async function probeRemoteDuration(url: string): Promise<ProbeResult> {
  try {
    const ffprobePath = await resolveFfprobePath();
    const { stdout, stderr } = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-probesize",
      "5000000",
      "-analyzeduration",
      "3000000",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      url,
    ], { timeout: 15000 }); // Longer timeout for single file recheck

    if (stderr) {
      console.warn("ffprobe stderr for", url, ":", stderr);
    }

    const parsed = JSON.parse(stdout);
    const duration = extractDurationSeconds(parsed);
    const { videoCodec, audioCodec } = extractCodecNames(parsed);

    if (duration !== null && Number.isFinite(duration) && duration > 0) {
      return { durationSeconds: duration, videoCodec, audioCodec, success: true };
    }
    return { durationSeconds: 0, videoCodec, audioCodec, success: false, error: "No duration found in metadata" };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errorDetails = error instanceof Error && 'stderr' in error 
      ? `${errMsg} | stderr: ${(error as { stderr?: string }).stderr}`
      : errMsg;
    console.warn("ffprobe failed for remote URL", url, errorDetails);
    return { durationSeconds: 0, success: false, error: errorDetails };
  }
}

export const runtime = "nodejs";

/**
 * POST /api/media-index/recheck
 * Recheck a single file that previously failed probing.
 * Body: { relPath: string }
 */
export async function POST(request: NextRequest) {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing FTP env vars (FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH).",
      },
      { status: 400 },
    );
  }

  let body: { relPath?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { relPath } = body;
  if (!relPath || typeof relPath !== "string") {
    return NextResponse.json(
      { success: false, message: "Missing required field: relPath" },
      { status: 400 },
    );
  }

  try {
    // Fetch existing media-index.json
    const manifestUrl = REMOTE_MEDIA_BASE.endsWith("/")
      ? `${REMOTE_MEDIA_BASE}media-index.json`
      : `${REMOTE_MEDIA_BASE}/media-index.json`;
    
    const res = await fetch(manifestUrl, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: "Could not fetch existing media-index.json" },
        { status: 500 },
      );
    }

    const existingIndex = await res.json() as MediaIndex;
    const items = existingIndex.items || [];
    
    // Find the item to recheck
    const itemIndex = items.findIndex(item => item.relPath === relPath);
    if (itemIndex === -1) {
      return NextResponse.json(
        { success: false, message: `File not found in index: ${relPath}` },
        { status: 404 },
      );
    }

    const item = items[itemIndex];
    console.log(`Rechecking file: ${relPath}`);

    // Build URL and probe the file
    const baseUrl = REMOTE_MEDIA_BASE.endsWith("/")
      ? REMOTE_MEDIA_BASE
      : REMOTE_MEDIA_BASE + "/";
    const pathParts = relPath.split('/');
    const encodedPath = pathParts.map(part => encodeURIComponent(part)).join('/');
    const fileUrl = baseUrl + encodedPath;

    const probeResult = await probeRemoteDuration(fileUrl);

    // Update the item
    const updatedItem: MediaItem = {
      ...item,
      durationSeconds: probeResult.durationSeconds,
      videoCodec: probeResult.videoCodec,
      audioCodec: probeResult.audioCodec,
      // Clear probeFailedAt on success, set it on failure
      probeFailedAt: probeResult.success ? undefined : new Date().toISOString(),
    };

    // If format/supported isn't set, compute it
    if (!updatedItem.format) {
      updatedItem.format = getFormat(path.basename(relPath));
    }
    if (updatedItem.supported === undefined) {
      updatedItem.supported = isSupported(updatedItem.format);
    }
    if (!updatedItem.title) {
      updatedItem.title = getTitle(path.basename(relPath));
    }

    items[itemIndex] = updatedItem;

    // Build updated payload
    const payload: MediaIndex = {
      generatedAt: new Date().toISOString(),
      items,
    };
    const payloadBody = JSON.stringify(payload, null, 2);

    // Upload updated media-index.json to remote
    const uploadClient = new Client(8000);
    try {
      await uploadClient.access({ host, port, user, password, secure });
      const targetDir = path.posix.dirname(remotePath);
      if (targetDir && targetDir !== ".") {
        await uploadClient.ensureDir(targetDir);
      }
      const stream = Readable.from([payloadBody]);
      await uploadClient.uploadFrom(stream, remotePath);
    } finally {
      uploadClient.close();
    }

    return NextResponse.json({
      success: true,
      probeSuccess: probeResult.success,
      message: probeResult.success 
        ? `Successfully rechecked ${relPath} - duration: ${updatedItem.durationSeconds}s`
        : `Recheck failed for ${relPath}: ${probeResult.error}`,
      file: {
        relPath: updatedItem.relPath,
        durationSeconds: updatedItem.durationSeconds,
        format: updatedItem.format,
        supported: updatedItem.supported,
        probeSuccess: probeResult.success,
        probeError: probeResult.error,
        videoCodec: updatedItem.videoCodec,
        audioCodec: updatedItem.audioCodec,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Recheck failed:", msg);
    return NextResponse.json(
      { success: false, message: `Recheck failed: ${msg}` },
      { status: 500 },
    );
  }
}
