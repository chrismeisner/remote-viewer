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
    // Incremental scan stats
    unchangedCount: number;
    newOrChangedCount: number;
    skippedFailureCount: number;
  };
};

type MediaItem = {
  relPath: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  title: string;
  videoCodec?: string;
  audioCodec?: string;
  // FTP metadata for incremental scanning
  size?: number;
  modifiedAt?: string; // ISO string
  // Track probe failures to avoid retrying every scan
  probeFailedAt?: string; // ISO string - when probe last failed
  // Track when file was first added to the library
  dateAdded?: string; // ISO string
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

type FtpFileInfo = {
  name: string;
  relPath: string;
  size: number;
  modifiedAt: string | null; // ISO string or null if unavailable
};

/**
 * Recursively list all media files in the current FTP directory and subdirectories
 * Captures size and modifiedAt for incremental scanning
 */
async function listMediaFilesRecursive(
  client: Client,
  currentPath: string,
): Promise<FtpFileInfo[]> {
  const fileList = await client.list(currentPath || undefined);
  const results: FtpFileInfo[] = [];
  
  for (const entry of fileList) {
    // Skip hidden files/folders
    if (entry.name.startsWith(".")) continue;
    
    const entryPath = currentPath ? path.posix.join(currentPath, entry.name) : entry.name;
    
    if (entry.isDirectory) {
      // Recursively scan subdirectory
      const subFiles = await listMediaFilesRecursive(client, entryPath);
      results.push(...subFiles);
    } else if (entry.isFile && isMediaFile(entry.name)) {
      // Add media file with its relative path, size, and mtime
      results.push({
        name: entry.name,
        relPath: entryPath,
        size: entry.size,
        modifiedAt: entry.modifiedAt ? entry.modifiedAt.toISOString() : null,
      });
    }
  }
  
  return results;
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
  videoCodec?: string;
  audioCodec?: string;
  success: boolean;
  error?: string;
};

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

/**
 * Extract duration from moov atom's mvhd sub-atom.
 * This is a fallback when ffprobe fails for remote files.
 * The mvhd atom contains timescale and duration fields.
 */
async function extractDurationFromMoov(url: string): Promise<{ duration: number | null; error?: string }> {
  const PROBE_SIZE = 128 * 1024; // 128KB to find moov
  
  try {
    // Try to find moov atom at the beginning (faststart files)
    const startRes = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_SIZE - 1}` },
    });
    
    if (!startRes.ok && startRes.status !== 206) {
      return { duration: null, error: `HTTP ${startRes.status}` };
    }
    
    const startBuffer = await startRes.arrayBuffer();
    let bytes = new Uint8Array(startBuffer);
    
    // Parse atoms to find moov
    let moovData: Uint8Array | null = null;
    let offset = 0;
    
    while (offset + 8 <= bytes.length) {
      const size = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      
      if (size < 8 || size > 0x7FFFFFFF || !/^[a-zA-Z0-9 ]{4}$/.test(type)) break;
      
      if (type === "moov") {
        // Found moov! Check if we have enough data
        if (offset + size <= bytes.length) {
          moovData = bytes.slice(offset, offset + size);
        } else {
          // Need to fetch the full moov atom
          const moovRes = await fetch(url, {
            headers: { Range: `bytes=${offset}-${offset + Math.min(size, 1024 * 1024) - 1}` },
          });
          if (moovRes.ok || moovRes.status === 206) {
            moovData = new Uint8Array(await moovRes.arrayBuffer());
          }
        }
        break;
      }
      
      if (type === "mdat") {
        // mdat before moov means moov is at the end - try to get file size and fetch end
        const headRes = await fetch(url, { method: "HEAD" });
        const contentLength = headRes.headers.get("content-length");
        if (contentLength) {
          const fileSize = parseInt(contentLength, 10);
          const endStart = Math.max(0, fileSize - PROBE_SIZE);
          const endRes = await fetch(url, {
            headers: { Range: `bytes=${endStart}-${fileSize - 1}` },
          });
          if (endRes.ok || endRes.status === 206) {
            bytes = new Uint8Array(await endRes.arrayBuffer());
            offset = 0;
            continue; // Re-scan from the end
          }
        }
        break;
      }
      
      offset += size;
    }
    
    if (!moovData) {
      return { duration: null, error: "Could not find moov atom" };
    }
    
    // Now find mvhd inside moov and extract duration
    // mvhd structure: [4 bytes size][4 bytes 'mvhd'][1 byte version][3 bytes flags]
    // version 0: [4 bytes creation][4 bytes modification][4 bytes timescale][4 bytes duration]
    // version 1: [8 bytes creation][8 bytes modification][4 bytes timescale][8 bytes duration]
    offset = 8; // Skip moov header
    while (offset + 8 <= moovData.length) {
      const atomSize = (moovData[offset] << 24) | (moovData[offset + 1] << 16) | (moovData[offset + 2] << 8) | moovData[offset + 3];
      const atomType = String.fromCharCode(moovData[offset + 4], moovData[offset + 5], moovData[offset + 6], moovData[offset + 7]);
      
      if (atomSize < 8) break;
      
      if (atomType === "mvhd") {
        const version = moovData[offset + 8];
        let timescale: number;
        let duration: number;
        
        if (version === 0) {
          // 32-bit values
          timescale = (moovData[offset + 20] << 24) | (moovData[offset + 21] << 16) | (moovData[offset + 22] << 8) | moovData[offset + 23];
          duration = (moovData[offset + 24] << 24) | (moovData[offset + 25] << 16) | (moovData[offset + 26] << 8) | moovData[offset + 27];
        } else {
          // 64-bit values (version 1)
          timescale = (moovData[offset + 28] << 24) | (moovData[offset + 29] << 16) | (moovData[offset + 30] << 8) | moovData[offset + 31];
          // Read 64-bit duration (we'll just use lower 32 bits for simplicity, works for videos < 136 years at 1000 timescale)
          duration = (moovData[offset + 36] << 24) | (moovData[offset + 37] << 16) | (moovData[offset + 38] << 8) | moovData[offset + 39];
        }
        
        if (timescale > 0 && duration > 0) {
          return { duration: Math.round(duration / timescale) };
        }
        break;
      }
      
      offset += atomSize;
    }
    
    return { duration: null, error: "Could not parse mvhd atom" };
  } catch (error) {
    return { duration: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function probeRemoteDuration(url: string): Promise<ProbeResult> {
  // First, try ffprobe with improved settings for remote files
  try {
    const ffprobePath = await resolveFfprobePath();
    const { stdout, stderr } = await execFileAsync(ffprobePath, [
      "-v",
      "error",                    // Show errors for debugging
      "-timeout",
      "5000000",                  // 5 second network timeout (in microseconds)
      "-reconnect",
      "1",                        // Reconnect on EOF
      "-reconnect_streamed",
      "1",                        // Reconnect for streaming
      "-reconnect_delay_max",
      "2",                        // Max 2 second reconnect delay
      "-probesize",
      "10000000",                 // Increased to 10MB for non-faststart files
      "-analyzeduration",
      "5000000",                  // Increased to 5 seconds analysis
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      url,
    ], { timeout: 12000 }); // 12 second timeout

    if (stderr) {
      console.warn("ffprobe stderr for", url, ":", stderr);
    }

    const parsed = JSON.parse(stdout);
    const duration = extractDurationSeconds(parsed);
    const { videoCodec, audioCodec } = extractCodecNames(parsed);

    if (duration !== null && Number.isFinite(duration) && duration > 0) {
      return { durationSeconds: duration, videoCodec, audioCodec, success: true };
    }
    
    // ffprobe ran but didn't find duration - try our fallback
    console.log("ffprobe no duration, trying moov parsing for", url);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errorDetails = error instanceof Error && 'stderr' in error 
      ? `${errMsg} | stderr: ${(error as { stderr?: string }).stderr}`
      : errMsg;
    console.warn("ffprobe failed for", url, "- trying moov fallback:", errorDetails);
  }
  
  // Fallback: Try to extract duration directly from moov atom
  // This works even when ffprobe fails due to network issues
  try {
    const moovResult = await extractDurationFromMoov(url);
    if (moovResult.duration && moovResult.duration > 0) {
      console.log("Got duration from moov for", url, ":", moovResult.duration, "seconds");
      return { durationSeconds: moovResult.duration, success: true };
    }
    return { durationSeconds: 0, success: false, error: moovResult.error || "Could not extract duration" };
  } catch (fallbackError) {
    const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    console.warn("moov fallback also failed for", url, ":", fallbackMsg);
    return { durationSeconds: 0, success: false, error: `ffprobe and moov parsing both failed: ${fallbackMsg}` };
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
    // Fetch existing remote media-index.json to get cached data
    // This allows incremental scanning: we only probe files that are new or changed
    type CachedItem = {
      durationSeconds: number;
      size?: number;
      modifiedAt?: string;
      probeFailedAt?: string;
      dateAdded?: string;
      videoCodec?: string;
      audioCodec?: string;
    };
    const existingItems = new Map<string, CachedItem>();
    try {
      const manifestUrl = REMOTE_MEDIA_BASE.endsWith("/")
        ? `${REMOTE_MEDIA_BASE}media-index.json`
        : `${REMOTE_MEDIA_BASE}/media-index.json`;
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (res.ok) {
        const existingIndex = await res.json() as { items?: MediaItem[] };
        for (const item of existingIndex.items || []) {
          existingItems.set(item.relPath, {
            durationSeconds: item.durationSeconds,
            size: item.size,
            modifiedAt: item.modifiedAt,
            probeFailedAt: item.probeFailedAt,
            dateAdded: item.dateAdded,
            videoCodec: item.videoCodec,
            audioCodec: item.audioCodec,
          });
        }
        console.log(`Loaded ${existingItems.size} existing items from remote index`);
      }
    } catch (err) {
      console.warn("Could not fetch existing remote index, will probe all files:", err);
    }

    // Connect to FTP and list files recursively
    // Use shorter timeout to stay within Heroku's 30s request limit
    const client = new Client(10000);
    let mediaFiles: FtpFileInfo[] = [];
    
    try {
      await client.access({ host, port, user, password, secure });
      
      // Navigate to the media directory (parent of remotePath which is media-index.json)
      const remoteDir = path.posix.dirname(remotePath);
      if (remoteDir && remoteDir !== ".") {
        await client.cd(remoteDir);
      }
      
      // Recursively list all media files
      mediaFiles = await listMediaFilesRecursive(client, "");
    } finally {
      client.close();
    }
    
    // How long to wait before retrying a failed probe (24 hours)
    const PROBE_RETRY_HOURS = 24;
    
    /**
     * Check if the file's size/mtime has changed from cached version
     */
    function hasFileChanged(f: FtpFileInfo, cached: CachedItem): boolean {
      // If we have size info, compare it
      if (cached.size !== undefined && cached.size !== f.size) {
        return true; // Size changed
      }
      
      // If we have modifiedAt info, compare it
      if (cached.modifiedAt && f.modifiedAt && cached.modifiedAt !== f.modifiedAt) {
        return true; // Modified time changed
      }
      
      return false;
    }
    
    /**
     * Determine if we should skip probing this file.
     * Skip if:
     * - File exists in cache with valid duration > 0 AND hasn't changed
     * - OR file exists in cache with recent probe failure AND hasn't changed
     */
    function shouldSkipProbe(f: FtpFileInfo, cached: CachedItem | undefined): { skip: boolean; reason: string } {
      if (!cached) {
        return { skip: false, reason: "new" };
      }
      
      const fileChanged = hasFileChanged(f, cached);
      
      // If file has valid duration and hasn't changed, skip
      if (cached.durationSeconds > 0 && !fileChanged) {
        return { skip: true, reason: "unchanged" };
      }
      
      // If probe recently failed and file hasn't changed, skip retry
      if (cached.probeFailedAt && !fileChanged) {
        const failedAt = new Date(cached.probeFailedAt);
        const hoursSinceFailure = (Date.now() - failedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceFailure < PROBE_RETRY_HOURS) {
          return { skip: true, reason: "recent-failure" };
        }
        // Enough time has passed, retry
        return { skip: false, reason: "retry-after-wait" };
      }
      
      // File changed or no recent failure, probe it
      return { skip: false, reason: fileChanged ? "changed" : "no-duration" };
    }

    // Build base URL for probing remote files
    const baseUrl = REMOTE_MEDIA_BASE.endsWith("/")
      ? REMOTE_MEDIA_BASE
      : REMOTE_MEDIA_BASE + "/";

    // Probe each file for duration (in parallel with concurrency limit)
    // IMPORTANT: Heroku has a 30-second request timeout, so we must be fast
    // Using incremental scanning: only probe new or changed files
    const items: MediaItem[] = [];
    const fileResults: FileResult[] = [];
    const CONCURRENCY = 2; // Lower concurrency since moov fallback makes multiple requests
    
    // Track stats
    let unchangedCount = 0;
    let newOrChangedCount = 0;
    let skippedFailureCount = 0;
    
    for (let i = 0; i < mediaFiles.length; i += CONCURRENCY) {
      const batch = mediaFiles.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (f) => {
          const format = getFormat(f.name);
          const supported = isSupported(format);
          const cached = existingItems.get(f.relPath);
          
          let durationSeconds: number;
          let videoCodec: string | undefined;
          let audioCodec: string | undefined;
          let probeSuccess: boolean;
          let probeError: string | undefined;
          let wasReprobed = false;
          let wasCached = false;
          let probeFailedAt: string | undefined;
          
          const { skip, reason } = shouldSkipProbe(f, cached);
          
          if (skip) {
            // Skip probing - use cached data
            durationSeconds = cached?.durationSeconds ?? 0;
            videoCodec = cached?.videoCodec;
            audioCodec = cached?.audioCodec;
            probeSuccess = cached?.durationSeconds ? cached.durationSeconds > 0 : false;
            wasCached = true;
            // Preserve the probeFailedAt timestamp if it exists
            probeFailedAt = cached?.probeFailedAt;
            
            if (reason === "recent-failure") {
              skippedFailureCount++;
              probeError = "Skipped - probe failed recently, will retry in 24h";
            } else {
              unchangedCount++;
            }
          } else {
            // Need to probe this file
            newOrChangedCount++;
            
            // Encode each path segment separately to handle subdirectories correctly
            const pathParts = f.relPath.split('/');
            const encodedPath = pathParts.map(part => encodeURIComponent(part)).join('/');
            const fileUrl = baseUrl + encodedPath;
            console.log(`Probing (${reason}) file: ${fileUrl}`);
            const probeResult = await probeRemoteDuration(fileUrl);
            durationSeconds = probeResult.durationSeconds;
            videoCodec = probeResult.videoCodec;
            audioCodec = probeResult.audioCodec;
            probeSuccess = probeResult.success;
            probeError = probeResult.error;
            wasReprobed = true;
            
            // If probe failed, record the timestamp so we don't retry too soon
            if (!probeSuccess) {
              probeFailedAt = new Date().toISOString();
            }
          }
          
          // Record detailed file result
          fileResults.push({
            file: f.relPath,
            durationSeconds,
            format,
            supported,
            probeSuccess,
            probeError,
            wasReprobed,
            wasCached,
          });
          
          // Preserve existing dateAdded or set to now for new files
          const dateAdded = cached?.dateAdded ?? new Date().toISOString();
          
          return {
            relPath: f.relPath,
            durationSeconds,
            format,
            supported,
            supportedViaCompanion: false,
            title: getTitle(f.name),
            videoCodec,
            audioCodec,
            // Store FTP metadata for future incremental scans
            size: f.size,
            modifiedAt: f.modifiedAt ?? undefined,
            probeFailedAt,
            dateAdded,
          };
        })
      );
      items.push(...batchResults);
    }
    
    console.log(`Incremental scan: ${unchangedCount} unchanged, ${newOrChangedCount} probed, ${skippedFailureCount} skipped (recent failure)`);
    
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
      // Incremental scan stats
      unchangedCount,
      newOrChangedCount,
      skippedFailureCount,
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
    const uploadClient = new Client(8000);
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

    // Build a descriptive message
    const messageParts = [`Scanned ${items.length} files`];
    if (unchangedCount > 0) {
      messageParts.push(`${unchangedCount} unchanged`);
    }
    if (skippedFailureCount > 0) {
      messageParts.push(`${skippedFailureCount} skipped (known issues)`);
    }
    if (newOrChangedCount > 0) {
      messageParts.push(`${newOrChangedCount} probed`);
    }
    
    return NextResponse.json({
      success: true,
      message: messageParts.join(", "),
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

