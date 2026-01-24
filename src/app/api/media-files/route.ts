import { NextRequest, NextResponse } from "next/server";
import { getScheduleItems, loadMediaMetadata, saveMediaMetadata } from "@/lib/media";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const refresh =
      request.nextUrl.searchParams.get("refresh") === "1" ||
      request.nextUrl.searchParams.get("refresh") === "true";

    const items = await getScheduleItems({ refresh });

    // Load metadata and auto-set dateAdded for new files
    const metadata = await loadMediaMetadata();
    let metadataChanged = false;
    const now = new Date().toISOString();

    // Check each file and set dateAdded if not present
    for (const item of items) {
      if (!metadata.items[item.relPath]) {
        metadata.items[item.relPath] = { dateAdded: now };
        metadataChanged = true;
      } else if (!metadata.items[item.relPath].dateAdded) {
        metadata.items[item.relPath].dateAdded = now;
        metadataChanged = true;
      }
    }

    // Save metadata if we added any new dateAdded fields
    if (metadataChanged) {
      await saveMediaMetadata(metadata);
    }

    // Add dateAdded to each item in the response
    const itemsWithDates = items.map((item) => ({
      ...item,
      dateAdded: metadata.items[item.relPath]?.dateAdded || now,
    }));

    return NextResponse.json({ items: itemsWithDates });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list media files";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function normalizeRel(rel: string): string {
  const safe = rel.replace(/^(\.\.(\/|\\|$))+/, "");
  return path.normalize(safe).replace(/\\/g, "/");
}


