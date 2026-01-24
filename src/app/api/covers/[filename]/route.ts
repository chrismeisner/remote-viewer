import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  getCoverImagePath,
  deleteCoverImage,
} from "@/lib/media";

export const runtime = "nodejs";

// MIME types for cover images
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * GET /api/covers/[filename]
 * 
 * Serve a specific cover image from the local covers folder.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    const { filename } = await params;
    
    if (!filename) {
      return NextResponse.json(
        { error: "Filename is required" },
        { status: 400 },
      );
    }
    
    const absPath = await getCoverImagePath(filename);
    
    if (!absPath) {
      return NextResponse.json(
        { error: "Cover image not found" },
        { status: 404 },
      );
    }
    
    // Get file stats for headers
    const fileStat = await stat(absPath);
    
    // Determine content type from extension
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || ".jpg";
    const contentType = EXT_TO_MIME[ext] || "application/octet-stream";
    
    // Create readable stream
    const stream = createReadStream(absPath);
    
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
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to serve cover: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/covers/[filename]
 * 
 * Delete a specific cover image from the local covers folder.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    const { filename } = await params;
    
    if (!filename) {
      return NextResponse.json(
        { error: "Filename is required" },
        { status: 400 },
      );
    }
    
    await deleteCoverImage(filename);
    
    return NextResponse.json({
      success: true,
      message: `Cover '${filename}' deleted`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { error: `Failed to delete cover: ${message}` },
      { status },
    );
  }
}
