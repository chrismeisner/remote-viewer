import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import { loadSchedule } from "@/lib/media";
import type { MediaMetadataItem, MediaMetadataStore } from "@/lib/media";
import { isFtpConfigured, uploadFileToFtp } from "@/lib/ftp";

export const runtime = "nodejs";

const CELL_WIDTH = 200;
const CELL_HEIGHT = 300;

/**
 * Given the number of available covers, return { cols, rows, use }
 * where `use` is how many covers to actually include in the grid.
 *
 *  1  → 1×1 (1)       7  → 3×2 (6)      15  → 5×3 (15)
 *  2  → 2×1 (2)       8  → 4×2 (8)      16  → 4×4 (16)
 *  3  → 3×1 (3)       9  → 3×3 (9)     17-19 → 4×4 (16)
 *  4  → 2×2 (4)      10  → 3×3 (9)      20  → 5×4 (20)
 *  5  → 2×2 (4)      11  → 3×3 (9)      21+ → 5×4 (20)
 *  6  → 3×2 (6)    12-14 → 4×3 (12)
 */
function pickLayout(count: number): { cols: number; rows: number; use: number } {
  if (count <= 1)  return { cols: 1, rows: 1, use: 1 };
  if (count === 2) return { cols: 2, rows: 1, use: 2 };
  if (count === 3) return { cols: 3, rows: 1, use: 3 };
  if (count <= 5)  return { cols: 2, rows: 2, use: 4 };
  if (count <= 7)  return { cols: 3, rows: 2, use: 6 };
  if (count === 8) return { cols: 4, rows: 2, use: 8 };
  if (count <= 11) return { cols: 3, rows: 3, use: 9 };
  if (count <= 14) return { cols: 4, rows: 3, use: 12 };
  if (count === 15) return { cols: 5, rows: 3, use: 15 };
  if (count <= 19) return { cols: 4, rows: 4, use: 16 };
  return              { cols: 5, rows: 4, use: 20 };
}

/** Randomly remove `removeCount` items from an array (Fisher-Yates partial shuffle). */
function randomSubset<T>(arr: T[], keep: number): T[] {
  if (arr.length <= keep) return arr;
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, keep);
}

function resolveCoverUrl(
  metadata: MediaMetadataItem,
): string | null {
  if (metadata.coverUrl) return metadata.coverUrl;
  if (metadata.coverLocal) {
    return `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(metadata.coverLocal)}`;
  }
  return null;
}

/**
 * POST /api/channels/[channel]/cover
 *
 * Generate a grid cover image from the channel's media cover art.
 * Fetches each unique cover, composites into a grid, and uploads to FTP.
 *
 * Remote-only: requires FTP configuration.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;

  if (!isFtpConfigured()) {
    return NextResponse.json(
      { error: "FTP not configured. This feature requires a remote media source." },
      { status: 400 },
    );
  }

  try {
    const schedule = await loadSchedule(channel, "remote");
    if (!schedule) {
      return NextResponse.json(
        { error: `Channel "${channel}" not found` },
        { status: 404 },
      );
    }

    const files: string[] = [];
    if (schedule.type === "looping" && schedule.playlist) {
      for (const item of schedule.playlist) {
        if (item.file) files.push(item.file);
      }
    } else if (schedule.slots) {
      for (const slot of schedule.slots) {
        if (slot.file) files.push(slot.file);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Channel has no media to generate a cover from" },
        { status: 400 },
      );
    }

    // Load metadata to resolve cover URLs
    const metadataRes = await fetch(
      `${REMOTE_MEDIA_BASE}media-metadata.json?t=${Date.now()}`,
      { cache: "no-store" },
    );
    let metadata: MediaMetadataStore = { items: {} };
    if (metadataRes.ok) {
      metadata = (await metadataRes.json()) as MediaMetadataStore;
    }

    // Collect unique cover URLs (deduplicate by URL)
    const seenUrls = new Set<string>();
    const coverUrls: string[] = [];

    for (const file of files) {
      const meta = metadata.items[file];
      if (!meta) continue;
      const url = resolveCoverUrl(meta);
      if (!url) continue;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      coverUrls.push(url);
    }

    if (coverUrls.length === 0) {
      return NextResponse.json(
        { error: "No cover art found for any media in this channel" },
        { status: 400 },
      );
    }

    // Fetch all cover images in parallel (with graceful failures)
    const fetched = await Promise.allSettled(
      coverUrls.map(async (url) => {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      }),
    );

    const imageBuffers: Buffer[] = [];
    for (const result of fetched) {
      if (result.status === "fulfilled") {
        imageBuffers.push(result.value);
      }
    }

    if (imageBuffers.length === 0) {
      return NextResponse.json(
        { error: "Failed to fetch any cover images" },
        { status: 500 },
      );
    }

    // Resize each cover image to a uniform cell size
    const resizedCells: Buffer[] = [];
    for (const buf of imageBuffers) {
      try {
        const resized = await sharp(buf)
          .resize(CELL_WIDTH, CELL_HEIGHT, { fit: "cover" })
          .jpeg({ quality: 85 })
          .toBuffer();
        resizedCells.push(resized);
      } catch {
        // Skip images that fail to process
      }
    }

    if (resizedCells.length === 0) {
      return NextResponse.json(
        { error: "Failed to process any cover images" },
        { status: 500 },
      );
    }

    // Pick layout and trim to fit
    const { cols, rows, use } = pickLayout(resizedCells.length);
    const cells = randomSubset(resizedCells, use);

    const gridWidth = cols * CELL_WIDTH;
    const gridHeight = rows * CELL_HEIGHT;

    const compositeInputs = cells.map((buf, i) => ({
      input: buf,
      left: (i % cols) * CELL_WIDTH,
      top: Math.floor(i / cols) * CELL_HEIGHT,
    }));

    const gridImage = await sharp({
      create: {
        width: gridWidth,
        height: gridHeight,
        channels: 3,
        background: { r: 23, g: 23, b: 23 },
      },
    })
      .composite(compositeInputs)
      .jpeg({ quality: 90 })
      .toBuffer();

    // Upload to FTP
    const filename = `channel-${channel}-grid.jpg`;
    const remotePath = `covers/${filename}`;
    await uploadFileToFtp(remotePath, gridImage);

    const url = `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(filename)}`;

    return NextResponse.json({
      url,
      filename,
      coverCount: cells.length,
      totalCovers: resizedCells.length,
      gridSize: { cols, rows, width: gridWidth, height: gridHeight },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate cover image";
    console.error("[Channel Cover] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
