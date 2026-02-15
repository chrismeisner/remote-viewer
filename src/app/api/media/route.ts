import { NextRequest, NextResponse } from "next/server";
import { createMediaStream, resolveMediaPath } from "@/lib/media";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function toWebStream(readable: Readable, signal?: AbortSignal): ReadableStream {
  return new ReadableStream({
    start(controller) {
      let closed = false;
      let onAbort: (() => void) | null = null;

      const cleanup = () => {
        readable.off("data", onData);
        readable.off("end", onClose);
        readable.off("close", onClose);
        readable.off("error", onError);
        if (signal && onAbort) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      const onClose = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Swallow close errors to avoid noisy logs
        }
      };

      const onError = (err: unknown) => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.error(err);
      };

      const onData = (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          // If enqueue fails (e.g. consumer went away), stop the stream quietly
          onClose();
        }
      };

      readable.on("data", onData);
      readable.once("end", onClose);
      readable.once("close", onClose);
      readable.once("error", onError);

      if (signal) {
        onAbort = () => {
          readable.destroy();
          onClose();
        };
        signal.addEventListener("abort", onAbort);
      }
    },
    cancel() {
      readable.destroy();
    },
  });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const relPath = url.searchParams.get("file");
  const source = url.searchParams.get("source") || "local";

  if (!relPath) {
    return NextResponse.json(
      { error: "file query param is required" },
      { status: 400 },
    );
  }

  // Handle remote source by proxying to remote media server
  if (source === "remote") {
    try {
      const remoteBase = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
      const remoteUrl = new URL(relPath, remoteBase).toString();
      
      // Get range header from client request
      const range = request.headers.get("range");
      
      // Build headers for remote request
      const fetchHeaders: HeadersInit = {};
      if (range) {
        fetchHeaders["Range"] = range;
      }
      
      // Fetch from remote server
      const remoteResponse = await fetch(remoteUrl, {
        headers: fetchHeaders,
        signal: request.signal,
      });
      
      if (!remoteResponse.ok) {
        return NextResponse.json(
          { error: `Remote media fetch failed: ${remoteResponse.statusText}` },
          { status: remoteResponse.status },
        );
      }
      
      // Forward response from remote server to client
      // Copy relevant headers
      const headers = new Headers();
      
      // Content headers
      const contentType = remoteResponse.headers.get("content-type");
      if (contentType) headers.set("Content-Type", contentType);
      
      const contentLength = remoteResponse.headers.get("content-length");
      if (contentLength) headers.set("Content-Length", contentLength);
      
      // Range headers for video seeking
      const contentRange = remoteResponse.headers.get("content-range");
      if (contentRange) headers.set("Content-Range", contentRange);
      
      const acceptRanges = remoteResponse.headers.get("accept-ranges");
      if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
      
      // Cache headers (optional - helps with performance)
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      
      return new NextResponse(remoteResponse.body, {
        status: remoteResponse.status,
        headers,
      });
    } catch (error) {
      console.error("[API Media] Remote proxy error:", error);
      const err = error as Error;
      return NextResponse.json(
        { error: `Remote media proxy failed: ${err.message}` },
        { status: 502 },
      );
    }
  }

  // Handle local source (existing code)
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

      const stream = toWebStream(
        createMediaStream(absPath, start, end),
        request.signal,
      );
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

    const stream = toWebStream(createMediaStream(absPath), request.signal);
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

