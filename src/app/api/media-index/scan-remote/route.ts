import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Client, FileInfo } from "basic-ftp";
import fs from "node:fs/promises";

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
const LOCAL_INDEX_PATH = path.join(process.cwd(), "data", "media-index.json");

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

    const items: MediaItem[] = mediaFiles.map((f) => {
      const format = getFormat(f.name);
      const supported = isSupported(format);
      // Try to get duration from local index, fallback to 0
      const durationSeconds = localDurations.get(f.name) || 0;
      
      return {
        relPath: f.name,
        durationSeconds,
        format,
        supported,
        supportedViaCompanion: false,
        title: getTitle(f.name),
      };
    });

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

