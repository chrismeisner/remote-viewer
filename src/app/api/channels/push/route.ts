import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Client } from "basic-ftp";
import { listChannels, type ChannelInfo } from "@/lib/media";

type PushResult = {
  success: boolean;
  message: string;
  remotePath?: string;
  channels?: ChannelInfo[];
};

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
    // Get local channels list
    const channels = await listChannels("local");
    const payload = { channels };
    const body = JSON.stringify(payload, null, 2);

    // Remote path: same folder as media-index.json, with channels.json
    const baseDir = path.posix.dirname(remotePath);
    const targetPath = path.posix.join(baseDir, "channels.json");

    const client = new Client(15000);
    try {
      await client.access({ host, port, user, password, secure });
      if (baseDir && baseDir !== ".") {
        await client.ensureDir(baseDir);
      }
      const stream = Readable.from([body]);
      await client.uploadFrom(stream, targetPath);
    } finally {
      client.close();
    }

    return NextResponse.json({
      success: true,
      message: `Uploaded channels.json to ${targetPath}`,
      remotePath: targetPath,
      channels,
    } satisfies PushResult);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Upload failed: ${msg}` } satisfies PushResult,
      { status: 500 },
    );
  }
}

