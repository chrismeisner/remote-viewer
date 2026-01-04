import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Client } from "basic-ftp";
import fs from "node:fs/promises";

type PushResult = {
  success: boolean;
  message: string;
  remotePath?: string;
  count?: number;
};

type MediaItem = {
  relPath: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  title: string;
};

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
    // Read the local media-index.json (which has proper durations from ffprobe)
    let localIndex: { items?: MediaItem[]; generatedAt?: string } = { items: [] };
    try {
      const raw = await fs.readFile(LOCAL_INDEX_PATH, "utf8");
      localIndex = JSON.parse(raw);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        return NextResponse.json(
          {
            success: false,
            message:
              "No local media-index.json found. Click 'Sync JSON' in local mode first to generate it.",
          } satisfies PushResult,
          { status: 400 },
        );
      }
      throw error;
    }

    const items = localIndex.items || [];
    if (items.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Local media-index.json is empty. Add media files and click 'Sync JSON' first.",
        } satisfies PushResult,
        { status: 400 },
      );
    }

    // Build the payload with timestamp
    const payload = {
      generatedAt: new Date().toISOString(),
      items,
    };
    const body = JSON.stringify(payload, null, 2);

    // Upload to remote via FTP
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
      message: `Uploaded media-index.json to ${remotePath} (${items.length} files)`,
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

