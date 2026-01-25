import { NextRequest, NextResponse } from "next/server";
import {
  loadMediaMetadata,
  loadMediaMetadataBySource,
  getMediaItemMetadata,
  getMediaItemMetadataBySource,
  updateMediaItemMetadataBySource,
  extractYearFromFilename,
  resolveCoverUrl,
  type MediaMetadataItem,
} from "@/lib/media";
import type { MediaSource } from "@/constants/media";

export const runtime = "nodejs";

/**
 * GET /api/media-metadata
 * 
 * Query params:
 *   - file: (optional) specific file to get metadata for
 *   - withAutoYear: (optional) if "true", includes auto-extracted year for items without explicit year
 *   - source: (optional) "local" or "remote" - defaults to "local"
 * 
 * Returns:
 *   - If file specified: metadata for that file
 *   - Otherwise: all metadata items
 */
export async function GET(request: NextRequest) {
  try {
    const fileParam = request.nextUrl.searchParams.get("file");
    const withAutoYear = request.nextUrl.searchParams.get("withAutoYear") === "true";
    const sourceParam = request.nextUrl.searchParams.get("source") as MediaSource | null;
    const source: MediaSource = sourceParam === "remote" ? "remote" : "local";
    
    if (fileParam) {
      // Get metadata for specific file
      const metadata = await getMediaItemMetadataBySource(fileParam, source);
      return NextResponse.json({
        file: fileParam,
        metadata,
        source,
      });
    }
    
    // Get all metadata
    const store = await loadMediaMetadataBySource(source);
    
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
      return NextResponse.json({ items: enhanced, source });
    }
    
    return NextResponse.json({ ...store, source });
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
 *   - source?: "local" | "remote" - defaults to "local"
 *   - title?: string | null
 *   - year?: number | null
 *   - director?: string | null
 *   - category?: string | null
 *   - makingOf?: string | null
 *   - plot?: string | null
 *   - type?: string | null - one of: film, tv, documentary, sports, concert, other
 *   - season?: number | null
 *   - episode?: number | null
 *   - coverUrl?: string | null - URL to external cover image
 *   - coverLocal?: string | null - filename of local cover in covers folder
 *   - coverPath?: string | null - full filesystem path for local mode
 *   - tags?: string[] | null - array of tags (actors, themes, keywords, etc.)
 * 
 * Returns: updated metadata for the file
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { file, source: sourceParam, title, year, director, category, makingOf, plot, type, season, episode, coverUrl, coverLocal, coverPath, tags } = body;
    const source: MediaSource = sourceParam === "remote" ? "remote" : "local";
    
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

    // Validate coverUrl if provided (should be a valid URL)
    if (coverUrl !== undefined && coverUrl !== null && coverUrl !== "") {
      try {
        new URL(coverUrl);
      } catch {
        return NextResponse.json(
          { error: "coverUrl must be a valid URL" },
          { status: 400 },
        );
      }
    }

    // Validate tags if provided (must be array of strings or null)
    if (tags !== undefined && tags !== null) {
      if (!Array.isArray(tags) || !tags.every((t: unknown) => typeof t === "string")) {
        return NextResponse.json(
          { error: "tags must be an array of strings" },
          { status: 400 },
        );
      }
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
    if (coverUrl !== undefined) updates.coverUrl = coverUrl === "" ? null : coverUrl;
    if (coverLocal !== undefined) updates.coverLocal = coverLocal === "" ? null : coverLocal;
    if (coverPath !== undefined) updates.coverPath = coverPath === "" ? null : coverPath;
    if (tags !== undefined) {
      // Filter empty strings and trim values
      updates.tags = tags === null ? null : tags.filter((t: string) => t.trim()).map((t: string) => t.trim());
    }
    
    const updated = await updateMediaItemMetadataBySource(file, updates, source);
    
    // Include resolved cover URL in response
    const resolvedCover = resolveCoverUrl(updated);
    
    return NextResponse.json({
      file,
      metadata: updated,
      resolvedCoverUrl: resolvedCover,
      source,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to update metadata: ${message}` },
      { status: 500 },
    );
  }
}
