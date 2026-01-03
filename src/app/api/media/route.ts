import { NextRequest, NextResponse } from "next/server";
import { createMediaStream, resolveMediaPath } from "@/lib/media";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const relPath = url.searchParams.get("file");

  if (!relPath) {
    return NextResponse.json(
      { error: "file query param is required" },
      { status: 400 },
    );
  }

  try {
    const absPath = await resolveMediaPath(relPath);
    const stat = await fs.stat(absPath);
    const range = request.headers.get("range");

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = Number(startStr);
      const end = endStr ? Number(endStr) : stat.size - 1;
      const chunkSize = end - start + 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start) {
        return NextResponse.json(
          { error: "Invalid range header" },
          { status: 416 },
        );
      }

      const stream = Readable.toWeb(createMediaStream(absPath, start, end));
      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentTypeForPath(absPath),
        },
      });
    }

    const stream = Readable.toWeb(createMediaStream(absPath));
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Length": String(stat.size),
        "Content-Type": contentTypeForPath(absPath),
      },
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const message = err?.message || "Failed to serve media";
    const status =
      err?.code === "ENOENT" || message.includes("not a file") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    default:
      return "application/octet-stream";
  }
}

