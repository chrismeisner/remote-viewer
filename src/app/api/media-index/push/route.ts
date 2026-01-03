import { execFile } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { Client, FileType } from "basic-ftp";
import ffprobe from "ffprobe-static";
import fs from "node:fs/promises";
import { getMediaRoot } from "@/lib/media";

type PushResult = {
  success: boolean;
  message: string;
  remotePath?: string;
  count?: number;
};

const execFileAsync = promisify(execFile);
const ALLOWED_EXTENSIONS = [".mp4", ".mkv", ".mov", ".avi", ".m4v", ".webm"];

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

export const runtime = "nodejs";

export async function POST() {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Missing FTP env vars (FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH). Set these in your environment.",
      } satisfies PushResult,
      { status: 400 },
    );
  }

  try {
    const items = await buildRemoteManifest(host, port, user, password, secure, remotePath);
    const payload = { items };
    const body = JSON.stringify(payload, null, 2);

    const client = new Client(15000);
    try {
      await client.access({ host, port, user, password, secure });
      const targetDir = path.posix.dirname(remotePath);
      if (targetDir && targetDir !== ".") {
        await client.ensureDir(targetDir);
      }
      const stream = Readable.from([body]);
      await client.uploadFrom(stream, remotePath);
    } finally {
      client.close();
    }

    return NextResponse.json({
      success: true,
      message: `Uploaded media-index.json to ${remotePath}`,
      remotePath,
      count: items.length,
    } satisfies PushResult);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Upload failed: ${msg}` } satisfies PushResult,
      { status: 500 },
    );
  }
}

async function buildRemoteManifest(
  host: string,
  port: number,
  user: string,
  password: string,
  secure: boolean,
  remoteManifestPath: string,
) {
  const baseDir = path.posix.dirname(remoteManifestPath);
  const client = new Client(15000);
  await client.access({ host, port, user, password, secure });
  try {
    const relPaths = await walkFtpMedia(client, baseDir);
    relPaths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    const friendlyBases = buildBrowserFriendlyBaseSet(relPaths);
    const mediaRoot = getMediaRoot();

    const items = [];
    for (const relPath of relPaths) {
      const absLocal = path.join(mediaRoot, relPath);
      const durationSeconds = await probeLocalDuration(absLocal);
      const format = formatFromPath(relPath);
      const supportedNative = isProbablyBrowserSupported(relPath);
      const supportedViaCompanion =
        !supportedNative && friendlyBases.has(baseNameWithoutExt(relPath));
      const supported = supportedNative || supportedViaCompanion;

      items.push({
        relPath,
        durationSeconds,
        format,
        supported,
        supportedViaCompanion,
        title: titleFromPath(relPath),
      });
    }

    return items;
  } finally {
    client.close();
  }
}

async function walkFtpMedia(client: Client, baseDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, prefix = ""): Promise<void> {
    const entries = await client.list(dir);
    for (const entry of entries) {
      const rel = path.posix.join(prefix, entry.name);
      const fullPath = path.posix.join(dir, entry.name);
      if (entry.type === FileType.Directory) {
        await walk(fullPath, rel);
        continue;
      }
      if (entry.type === FileType.File && isAllowedExtension(entry.name)) {
        results.push(rel);
      }
    }
  }

  await walk(baseDir, "");
  return results;
}

function isAllowedExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

function formatFromPath(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase().replace(/^\./, "");
  return ext || "unknown";
}

function titleFromPath(relPath: string): string {
  const base = path.basename(relPath);
  return base.replace(path.extname(base), "");
}

function baseNameWithoutExt(relPath: string): string {
  const base = path.basename(relPath);
  return base.replace(path.extname(base), "");
}

function buildBrowserFriendlyBaseSet(files: string[]): Set<string> {
  const friendly = new Set<string>();
  for (const rel of files) {
    if (isProbablyBrowserSupported(rel)) {
      friendly.add(baseNameWithoutExt(rel));
    }
  }
  return friendly;
}

function isProbablyBrowserSupported(relPath: string): boolean {
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

async function probeLocalDuration(absPath: string): Promise<number> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return 0;
  } catch {
    return 0;
  }

  try {
    const { stdout } = await execFileAsync(ffprobe.path, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      absPath,
    ]);
    const parsed = JSON.parse(stdout);
    const duration = parseFloat(parsed?.format?.duration);
    if (Number.isFinite(duration) && duration > 0) {
      return Math.round(duration);
    }
  } catch (error) {
    console.warn("ffprobe failed", absPath, error);
  }
  return 0;
}

