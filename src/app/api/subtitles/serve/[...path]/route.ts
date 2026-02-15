import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getEffectiveMediaRoot } from "@/lib/config";

export const runtime = "nodejs";

/**
 * GET /api/subtitles/serve/[...path]
 *
 * Serve a .vtt subtitle file from the local media folder.
 * Used in local mode — remote mode reads directly from the CDN.
 *
 * Example: /api/subtitles/serve/movies/The%20Matrix%20(1999).en.vtt
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params;

    if (!segments || segments.length === 0) {
      return NextResponse.json(
        { error: "Subtitle path is required" },
        { status: 400 }
      );
    }

    const relPath = segments.map(decodeURIComponent).join("/");
    console.log("[subtitles/serve] request for:", relPath, "segments:", segments);

    // Must be a .vtt file
    if (!relPath.endsWith(".vtt")) {
      return NextResponse.json(
        { error: "Only .vtt files can be served" },
        { status: 400 }
      );
    }

    const mediaRoot = await getEffectiveMediaRoot();
    if (!mediaRoot) {
      return NextResponse.json(
        { error: "No media folder configured" },
        { status: 400 }
      );
    }

    const absPath = path.join(mediaRoot, relPath);

    // Security: ensure path stays within media root
    if (!absPath.startsWith(mediaRoot)) {
      return NextResponse.json(
        { error: "Invalid path" },
        { status: 400 }
      );
    }

    const fileStat = await stat(absPath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      console.warn("[subtitles/serve] file not found:", absPath);
      return NextResponse.json(
        { error: "Subtitle file not found" },
        { status: 404 }
      );
    }

    console.log("[subtitles/serve] serving", absPath, "size:", fileStat.size);
    const stream = createReadStream(absPath);
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Content-Length": fileStat.size.toString(),
        "Cache-Control": "public, max-age=3600",
        "Last-Modified": fileStat.mtime.toUTCString(),
        // CORS headers for <track> element cross-origin loading
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to serve subtitle: ${message}` },
      { status: 500 }
    );
  }
}
