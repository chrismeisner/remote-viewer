import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getScheduleItems, getLocalMediaIndexFilePath } from "@/lib/media";

export const runtime = "nodejs";

/**
 * GET: Read the local media index from data/media-index.json
 */
export async function GET() {
  try {
    const indexPath = await getLocalMediaIndexFilePath();
    
    // No folder configured
    if (!indexPath) {
      return NextResponse.json({ 
        items: [], 
        message: "No media folder configured. Please configure a folder in Source settings." 
      });
    }
    
    const raw = await fs.readFile(indexPath, "utf8");
    const json = JSON.parse(raw);
    return NextResponse.json(json);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return NextResponse.json({ items: [], message: "No local index found. Click 'Scan Media' to create one." });
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
    const indexPath = await getLocalMediaIndexFilePath();
    
    // No folder configured
    if (!indexPath) {
      return NextResponse.json(
        { success: false, message: "No media folder configured. Please configure a folder in Source settings." },
        { status: 400 },
      );
    }
    
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
        audioCodec: item.audioCodec,
      })),
    };

    // Ensure data directory exists
    await fs.mkdir(path.dirname(indexPath), { recursive: true });

    // Write the index file
    await fs.writeFile(indexPath, JSON.stringify(payload, null, 2), "utf8");

    return NextResponse.json({
      success: true,
      message: `Saved media-index.json with ${items.length} files`,
      path: indexPath,
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
