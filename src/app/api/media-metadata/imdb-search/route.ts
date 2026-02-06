import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type ImdbCandidate = {
  imdbUrl: string;
  title: string;
  year: number | null;
  type: string; // "film", "tv", "documentary", etc.
  rating?: number | null;
  image?: string | null;
};

/**
 * Map IMDB title types from the API to our simplified types
 */
function mapTitleType(apiType: string): string {
  switch (apiType) {
    case "movie":
    case "tvMovie":
      return "film";
    case "tvSeries":
    case "tvMiniSeries":
      return "tv";
    case "tvSpecial":
      return "tv";
    case "short":
    case "tvShort":
      return "film";
    case "documentary":
      return "documentary";
    default:
      return "film";
  }
}

/**
 * POST /api/media-metadata/imdb-search
 *
 * Uses the free IMDb API (imdbapi.dev) to search for real IMDB title matches.
 *
 * Body:
 *   - filename: string
 *   - title?: string (existing title if known)
 *   - year?: number (existing year if known)
 *   - type?: string (film, tv, etc.)
 *   - director?: string
 *   - category?: string
 *   - season?: number
 *   - episode?: number
 *
 * Returns:
 *   - candidates: ImdbCandidate[]
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filename, title, year, type } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }

    // Determine the search query — prefer title, fall back to cleaned filename
    let searchQuery: string;

    if (title && typeof title === "string" && title.trim().length > 0) {
      searchQuery = title.trim();
    } else {
      // Extract a usable query from the filename
      // e.g. "Clone.High.S01E01.480p.AMZN.WEB-DL.DDP2.0.H.264-TEPES.mp4"
      // → "Clone High"
      const basename = filename.split("/").pop() || filename;
      searchQuery = basename
        // Remove file extension
        .replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts)$/i, "")
        // Remove common scene tags: S01E01, 480p, 720p, 1080p, codec info, etc.
        .replace(/[.\s_]?S\d{1,2}E\d{1,2}.*/i, "")
        .replace(/[.\s_]?\d{3,4}p.*/i, "")
        .replace(/[.\s_]?(WEB-DL|WEBRip|BluRay|BRRip|DVDRip|HDTV|AMZN|NF|COMPLETE).*/i, "")
        // Replace dots and underscores with spaces
        .replace(/[._]/g, " ")
        // Clean up extra spaces
        .replace(/\s+/g, " ")
        .trim();
    }

    console.log(`[IMDB Search] Query: "${searchQuery}" (from title: "${title}", filename: "${filename}")`);

    // Search via imdbapi.dev
    const apiUrl = `https://api.imdbapi.dev/search/titles?query=${encodeURIComponent(searchQuery)}`;
    console.log(`[IMDB Search] API URL: ${apiUrl}`);

    const apiResponse = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!apiResponse.ok) {
      console.error(`[IMDB Search] API returned ${apiResponse.status}`);
      return NextResponse.json(
        { error: `IMDB search API returned ${apiResponse.status}` },
        { status: 502 }
      );
    }

    const apiData = await apiResponse.json();
    const results = apiData?.titles;

    if (!Array.isArray(results) || results.length === 0) {
      console.log("[IMDB Search] No results from API");
      return NextResponse.json({ candidates: [] });
    }

    console.log(`[IMDB Search] API returned ${results.length} raw results`);

    // Convert API results to our candidate format
    const allCandidates: ImdbCandidate[] = results
      .filter((r: { id?: string }) => r.id && typeof r.id === "string" && r.id.startsWith("tt"))
      .map((r: {
        id: string;
        primaryTitle?: string;
        originalTitle?: string;
        type?: string;
        startYear?: number;
        rating?: { aggregateRating?: number };
        primaryImage?: { url?: string };
      }) => ({
        imdbUrl: `https://www.imdb.com/title/${r.id}/`,
        title: r.primaryTitle || r.originalTitle || "Unknown",
        year: typeof r.startYear === "number" ? r.startYear : null,
        type: mapTitleType(r.type || ""),
        rating: r.rating?.aggregateRating ?? null,
        image: r.primaryImage?.url ?? null,
      }));

    // Score and rank candidates based on how well they match our metadata
    const scoredCandidates = allCandidates.map((candidate) => {
      let score = 0;

      // Title match (exact = +100, case-insensitive = +80, contains = +40)
      const candidateTitle = candidate.title.toLowerCase();
      const queryTitle = searchQuery.toLowerCase();
      if (candidateTitle === queryTitle) {
        score += 100;
      } else if (candidateTitle.includes(queryTitle) || queryTitle.includes(candidateTitle)) {
        score += 40;
      }

      // Year match (+30 for exact, +15 for within 2 years)
      if (year && candidate.year) {
        const yearNum = typeof year === "number" ? year : parseInt(String(year), 10);
        if (!isNaN(yearNum)) {
          if (candidate.year === yearNum) {
            score += 30;
          } else if (Math.abs(candidate.year - yearNum) <= 2) {
            score += 15;
          }
        }
      }

      // Type match (+20)
      if (type) {
        const normalizedType = type.toLowerCase().replace(/\s+/g, "");
        const candidateType = candidate.type.toLowerCase();
        if (
          (normalizedType.includes("tv") && candidateType === "tv") ||
          (normalizedType.includes("film") && candidateType === "film") ||
          (normalizedType.includes("movie") && candidateType === "film") ||
          (normalizedType.includes("doc") && candidateType === "documentary")
        ) {
          score += 20;
        }
      }

      // Rating bonus (higher rated = more likely to be the correct/popular one)
      if (candidate.rating) {
        score += candidate.rating; // 0-10 bonus
      }

      return { ...candidate, score };
    });

    // Sort by score descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Return top 5 candidates (strip internal score)
    const finalCandidates: ImdbCandidate[] = scoredCandidates
      .slice(0, 5)
      .map(({ score: _score, ...rest }) => rest);

    console.log(
      `[IMDB Search] Returning ${finalCandidates.length} candidates:`,
      finalCandidates.map((c) => `${c.title} (${c.year}) ${c.imdbUrl}`)
    );

    return NextResponse.json({ candidates: finalCandidates });
  } catch (error) {
    console.error("[IMDB Search] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
