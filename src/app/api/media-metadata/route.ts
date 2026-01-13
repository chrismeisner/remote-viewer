import { NextRequest, NextResponse } from "next/server";
import {
  loadMediaMetadata,
  getMediaItemMetadata,
  updateMediaItemMetadata,
  extractYearFromFilename,
  type MediaMetadataItem,
} from "@/lib/media";

export const runtime = "nodejs";

/**
 * GET /api/media-metadata
 * 
 * Query params:
 *   - file: (optional) specific file to get metadata for
 *   - withAutoYear: (optional) if "true", includes auto-extracted year for items without explicit year
 * 
 * Returns:
 *   - If file specified: metadata for that file
 *   - Otherwise: all metadata items
 */
export async function GET(request: NextRequest) {
  try {
    const fileParam = request.nextUrl.searchParams.get("file");
    const withAutoYear = request.nextUrl.searchParams.get("withAutoYear") === "true";
    
    if (fileParam) {
      // Get metadata for specific file
      const metadata = await getMediaItemMetadata(fileParam);
      return NextResponse.json({
        file: fileParam,
        metadata,
      });
    }
    
    // Get all metadata
    const store = await loadMediaMetadata();
    
    // If requested, add auto-extracted year to items without explicit year
    if (withAutoYear) {
      const enhanced: Record<string, MediaMetadataItem> = {};
      for (const [relPath, item] of Object.entries(store.items)) {
        if (item.year === undefined) {
          enhanced[relPath] = {
            ...item,
            year: extractYearFromFilename(relPath),
          };
        } else {
          enhanced[relPath] = item;
        }
      }
      return NextResponse.json({ items: enhanced });
    }
    
    return NextResponse.json(store);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to load metadata: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/media-metadata
 * 
 * Body:
 *   - file: string (required) - the relPath of the media file
 *   - year?: number | null
 *   - director?: string | null
 *   - category?: string | null
 * 
 * Returns: updated metadata for the file
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { file, title, year, director, category, makingOf, plot, type, season, episode } = body;
    
    if (!file || typeof file !== "string") {
      return NextResponse.json(
        { error: "Missing required 'file' field" },
        { status: 400 },
      );
    }
    
    // Validate year if provided
    if (year !== undefined && year !== null) {
      const yearNum = Number(year);
      if (!Number.isInteger(yearNum) || yearNum < 1800 || yearNum > 2100) {
        return NextResponse.json(
          { error: "Year must be a valid integer between 1800 and 2100" },
          { status: 400 },
        );
      }
    }

    // Validate type if provided
    const validTypes = ["film", "tv", "documentary", "sports", "concert", "other"];
    if (type !== undefined && type !== null && type !== "" && !validTypes.includes(type)) {
      return NextResponse.json(
        { error: "Type must be one of: film, tv, documentary, sports, concert, other" },
        { status: 400 },
      );
    }
    
    const updates: Partial<MediaMetadataItem> = {};
    if (title !== undefined) updates.title = title === "" ? null : title;
    if (year !== undefined) updates.year = year === null ? null : Number(year);
    if (director !== undefined) updates.director = director === "" ? null : director;
    if (category !== undefined) updates.category = category === "" ? null : category;
    if (makingOf !== undefined) updates.makingOf = makingOf === "" ? null : makingOf;
    if (plot !== undefined) updates.plot = plot === "" ? null : plot;
    if (type !== undefined) updates.type = type === "" ? null : type;
    if (season !== undefined) updates.season = season === null || season === "" ? null : Number(season);
    if (episode !== undefined) updates.episode = episode === null || episode === "" ? null : Number(episode);
    
    const updated = await updateMediaItemMetadata(file, updates);
    
    return NextResponse.json({
      file,
      metadata: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to update metadata: ${message}` },
      { status: 500 },
    );
  }
}
