import { NextRequest, NextResponse } from "next/server";
import {
  updateMediaItemMetadataBySource,
  getMediaItemMetadataBySource,
} from "@/lib/media";
import { ensureVtt, buildSubtitlePath } from "@/lib/subtitles";
import { uploadFileToFtp, isFtpConfigured } from "@/lib/ftp";
import type { MediaSource } from "@/constants/media";
import fs from "node:fs/promises";
import path from "node:path";
import { getEffectiveMediaRoot } from "@/lib/config";

export const runtime = "nodejs";

/**
 * POST /api/subtitles
 *
 * Upload a subtitle file (.srt or .vtt) for a media item.
 * The file is converted to .vtt if needed, stored alongside the video,
 * and the media metadata is updated with the subtitle path.
 *
 * Form data:
 *   - file: the subtitle file (required)
 *   - relPath: the video's relative path (required)
 *   - source: "local" or "remote" (optional, defaults to "local")
 *   - lang: language code (optional, defaults to "en")
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const relPath = formData.get("relPath") as string | null;
    const sourceParam = formData.get("source") as MediaSource | null;
    const lang = (formData.get("lang") as string) || "en";
    const source: MediaSource = sourceParam === "remote" ? "remote" : "local";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!relPath) {
      return NextResponse.json(
        { error: "relPath is required" },
        { status: 400 }
      );
    }

    // Read and convert the uploaded file
    const rawText = await file.text();
    console.log("[subtitles] upload received", {
      filename: file.name,
      size: file.size,
      relPath,
      source,
      lang,
      rawLength: rawText.length,
    });

    const vttContent = ensureVtt(rawText, file.name);
    const subtitleRelPath = buildSubtitlePath(relPath, lang);
    const vttBuffer = Buffer.from(vttContent, "utf-8");

    console.log("[subtitles] converted to VTT", {
      inputFile: file.name,
      outputPath: subtitleRelPath,
      vttLength: vttContent.length,
      firstLine: vttContent.split("\n")[0],
      cueCount: (vttContent.match(/-->/g) || []).length,
    });

    if (source === "remote") {
      // Upload to FTP
      if (!isFtpConfigured()) {
        return NextResponse.json(
          { error: "FTP is not configured. Cannot upload subtitles to remote." },
          { status: 400 }
        );
      }
      console.log("[subtitles] uploading to FTP:", subtitleRelPath);
      await uploadFileToFtp(subtitleRelPath, vttBuffer);
      console.log("[subtitles] FTP upload complete");
    } else {
      // Save to local filesystem alongside the video
      const mediaRoot = await getEffectiveMediaRoot();
      if (!mediaRoot) {
        return NextResponse.json(
          { error: "No media folder configured for local mode." },
          { status: 400 }
        );
      }
      const absPath = path.join(mediaRoot, subtitleRelPath);
      // Security: ensure path stays within media root
      if (!absPath.startsWith(mediaRoot)) {
        return NextResponse.json(
          { error: "Invalid subtitle path" },
          { status: 400 }
        );
      }
      console.log("[subtitles] saving to local filesystem:", absPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, vttBuffer);
      console.log("[subtitles] local file written successfully");
    }

    // Update metadata to record the subtitle file
    // updateMediaItemMetadataBySource handles FTP push for remote source automatically
    console.log("[subtitles] updating metadata for", relPath, "→", subtitleRelPath);
    await updateMediaItemMetadataBySource(
      relPath,
      { subtitleFile: subtitleRelPath },
      source
    );
    console.log("[subtitles] metadata updated successfully");

    return NextResponse.json({
      success: true,
      subtitleFile: subtitleRelPath,
      source,
    });
  } catch (error) {
    console.error("[subtitles] upload error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to upload subtitles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/subtitles
 *
 * Remove a subtitle file for a media item.
 *
 * Query params:
 *   - relPath: the video's relative path (required)
 *   - source: "local" or "remote" (optional, defaults to "local")
 */
export async function DELETE(request: NextRequest) {
  try {
    const relPath = request.nextUrl.searchParams.get("relPath");
    const sourceParam = request.nextUrl.searchParams.get("source") as MediaSource | null;
    const source: MediaSource = sourceParam === "remote" ? "remote" : "local";

    if (!relPath) {
      return NextResponse.json(
        { error: "relPath is required" },
        { status: 400 }
      );
    }

    // Get current metadata to find subtitle file path
    const metadata = await getMediaItemMetadataBySource(relPath, source);
    const subtitleFile = metadata.subtitleFile;
    console.log("[subtitles] delete requested", { relPath, source, subtitleFile });

    // Remove the actual file
    if (subtitleFile) {
      if (source === "remote") {
        // Delete from FTP
        if (isFtpConfigured()) {
          try {
            const { deleteFileFromFtp } = await import("@/lib/ftp");
            await deleteFileFromFtp(subtitleFile);
          } catch (err) {
            console.warn("[subtitles] failed to delete remote file:", err);
          }
        }
      } else {
        // Delete local file
        const mediaRoot = await getEffectiveMediaRoot();
        if (mediaRoot) {
          const absPath = path.join(mediaRoot, subtitleFile);
          if (absPath.startsWith(mediaRoot)) {
            try {
              await fs.unlink(absPath);
            } catch (err) {
              const e = err as NodeJS.ErrnoException;
              if (e.code !== "ENOENT") {
                console.warn("[subtitles] failed to delete local file:", err);
              }
            }
          }
        }
      }
    }

    // Clear subtitle from metadata
    // updateMediaItemMetadataBySource handles FTP push for remote source automatically
    await updateMediaItemMetadataBySource(
      relPath,
      { subtitleFile: null },
      source
    );

    return NextResponse.json({ success: true, source });
  } catch (error) {
    console.error("[subtitles] delete error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to remove subtitles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
