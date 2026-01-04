import { NextResponse } from "next/server";
import { REMOTE_MEDIA_BASE } from "@/constants/media";

export const runtime = "nodejs";

type FileStatus = {
  file: string;
  url: string;
  status: "found" | "missing" | "error";
  mediaCount?: number;
  channelCount?: number;
  scheduleChannelCount?: number;
  error?: string;
};

export async function GET() {
  const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
  if (!base) {
    return NextResponse.json(
      { error: "REMOTE_MEDIA_BASE is not configured", files: [] },
      { status: 400 },
    );
  }

  const filesToCheck = [
    { file: "media-index.json", url: `${base}media-index.json` },
    { file: "channels.json", url: `${base}channels.json` },
    { file: "schedule.json", url: `${base}schedule.json` },
  ];

  const results: FileStatus[] = [];

  for (const { file, url } of filesToCheck) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const status: FileStatus = { file, url, status: "found" };

        // Add extra info based on file type
        if (file === "media-index.json" && data.items) {
          status.mediaCount = data.items.length;
        } else if (file === "channels.json" && data.channels) {
          status.channelCount = data.channels.length;
        } else if (file === "schedule.json" && data.channels) {
          status.scheduleChannelCount = Object.keys(data.channels).length;
        }

        results.push(status);
      } else if (res.status === 404) {
        results.push({ file, url, status: "missing" });
      } else {
        results.push({ file, url, status: "error", error: `HTTP ${res.status}` });
      }
    } catch (err) {
      results.push({
        file,
        url,
        status: "error",
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  return NextResponse.json({ files: results, base });
}

