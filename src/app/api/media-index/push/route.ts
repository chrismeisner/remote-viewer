import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getLocalMediaIndexFilePath } from "@/lib/media";
import { isFtpConfigured, uploadJsonToFtp, getRemoteBaseDir, requireFtpConfig } from "@/lib/ftp";

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
  videoCodec?: string;
  audioCodec?: string;
};

export const runtime = "nodejs";

export async function POST() {
  if (!isFtpConfigured()) {
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
    const indexPath = await getLocalMediaIndexFilePath();
    
    // No folder configured
    if (!indexPath) {
      return NextResponse.json(
        {
          success: false,
          message: "No media folder configured. Please configure a folder in Source settings first.",
        } satisfies PushResult,
        { status: 400 },
      );
    }
    
    // Read the local media-index.json (which has proper durations from ffprobe)
    let localIndex: { items?: MediaItem[]; generatedAt?: string } = { items: [] };
    try {
      const raw = await fs.readFile(indexPath, "utf8");
      localIndex = JSON.parse(raw);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        return NextResponse.json(
          {
            success: false,
            message:
              "No local media-index.json found. Click 'Scan Media' in local mode first to generate it.",
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

    // Upload to remote via FTP
    const config = requireFtpConfig();
    const remotePath = await uploadJsonToFtp("media-index.json", payload);

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
