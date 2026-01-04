import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getScheduleItems } from "@/lib/media";

export const runtime = "nodejs";

const LOCAL_INDEX_PATH = path.join(process.cwd(), "data", "media-index.json");

/**
 * GET: Read the local media index from data/media-index.json
 */
export async function GET() {
  try {
    const raw = await fs.readFile(LOCAL_INDEX_PATH, "utf8");
    const json = JSON.parse(raw);
    return NextResponse.json(json);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return NextResponse.json({ items: [], message: "No local index found. Click 'Sync JSON' to create one." });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Scan local media folder and save to data/media-index.json
 */
export async function POST() {
  try {
    // Scan media folder with refresh to get latest
    const items = await getScheduleItems({ refresh: true });

    const payload = {
      generatedAt: new Date().toISOString(),
      items: items.map((item) => ({
        relPath: item.relPath,
        durationSeconds: item.durationSeconds,
        format: item.format,
        supported: item.supported,
        supportedViaCompanion: item.supportedViaCompanion,
        title: item.title,
      })),
    };

    // Ensure data directory exists
    await fs.mkdir(path.dirname(LOCAL_INDEX_PATH), { recursive: true });

    // Write the index file
    await fs.writeFile(LOCAL_INDEX_PATH, JSON.stringify(payload, null, 2), "utf8");

    return NextResponse.json({
      success: true,
      message: `Saved media-index.json with ${items.length} files`,
      path: "data/media-index.json",
      count: items.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Failed to save: ${message}` },
      { status: 500 },
    );
  }
}

