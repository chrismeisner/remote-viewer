import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { isLocalMode } from "@/lib/config";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * GET /api/local-image?path=/path/to/image.jpg
 * 
 * Serve a local image file. Only available in local mode.
 * Security: Only serves files with allowed image extensions.
 */
export async function GET(request: NextRequest) {
  // Only allow in local mode
  if (!isLocalMode()) {
    return NextResponse.json(
      { error: "Local image serving is only available in local mode" },
      { status: 403 }
    );
  }

  const imagePath = request.nextUrl.searchParams.get("path");
  
  if (!imagePath) {
    return NextResponse.json(
      { error: "Missing required 'path' parameter" },
      { status: 400 }
    );
  }

  try {
    // Resolve and validate path
    const resolvedPath = path.resolve(imagePath);
    const ext = path.extname(resolvedPath).toLowerCase();
    
    // Security: Only allow image extensions
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: "Invalid file type. Only image files are allowed." },
        { status: 400 }
      );
    }
    
    // Check file exists and is a file
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      return NextResponse.json(
        { error: "Path is not a file" },
        { status: 400 }
      );
    }
    
    // Get content type
    const contentType = EXT_TO_MIME[ext] || "application/octet-stream";
    
    // Create readable stream
    const stream = createReadStream(resolvedPath);
    
    // Convert Node.js stream to Web stream
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => {
          controller.enqueue(chunk);
        });
        stream.on("end", () => {
          controller.close();
        });
        stream.on("error", (err) => {
          controller.error(err);
        });
      },
      cancel() {
        stream.destroy();
      },
    });
    
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileStat.size.toString(),
        "Cache-Control": "public, max-age=86400", // Cache for 1 day
        "Last-Modified": fileStat.mtime.toUTCString(),
      },
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return NextResponse.json(
        { error: "Image file not found" },
        { status: 404 }
      );
    }
    if (err?.code === "EACCES") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }
    const message = err?.message || "Failed to serve image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
