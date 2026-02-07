import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/media-metadata/imdb-preview?id=tt0163651
 *
 * Fetches preview data for an IMDB title by scraping the page's JSON-LD
 * and Open Graph meta tags. Returns title, year, type, rating, and image.
 */
export async function GET(request: NextRequest) {
  try {
    const titleId = request.nextUrl.searchParams.get("id");

    if (!titleId || !/^tt\d{7,8}$/.test(titleId)) {
      return NextResponse.json(
        { error: "Valid IMDB title ID required (e.g. tt0163651)" },
        { status: 400 }
      );
    }

    const url = `https://www.imdb.com/title/${titleId}/`;
    console.log(`[IMDB Preview] Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[IMDB Preview] Page returned ${response.status}`);
      return NextResponse.json(
        { error: `IMDB returned ${response.status}` },
        { status: 502 }
      );
    }

    const html = await response.text();

    // --- Parse JSON-LD schema ---
    let title: string | null = null;
    let year: number | null = null;
    let type: string | null = null;
    let rating: number | null = null;
    let image: string | null = null;

    const jsonLdMatch = html.match(
      /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (jsonLdMatch?.[1]) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);

        // Title
        title = ld.name || ld.alternateName || null;

        // Image
        if (typeof ld.image === "string") {
          image = ld.image;
        } else if (ld.image?.url) {
          image = ld.image.url;
        }

        // Type mapping
        const ldType = ld["@type"];
        if (ldType === "Movie" || ldType === "ShortFilm") type = "movie";
        else if (ldType === "TVSeries") type = "tvSeries";
        else if (ldType === "TVEpisode") type = "tvEpisode";
        else if (ldType === "TVSeason") type = "tvSeason";
        else if (ldType) type = ldType;

        // Rating
        if (ld.aggregateRating?.ratingValue != null) {
          rating = parseFloat(ld.aggregateRating.ratingValue);
          if (isNaN(rating)) rating = null;
        }

        // Year — from datePublished
        if (ld.datePublished) {
          const y = parseInt(ld.datePublished.substring(0, 4), 10);
          if (!isNaN(y) && y > 1800 && y < 2100) year = y;
        }
      } catch (e) {
        console.warn("[IMDB Preview] JSON-LD parse error:", e);
      }
    }

    // --- Fallback: og:image ---
    if (!image) {
      const ogImg =
        html.match(
          /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i
        ) ||
        html.match(
          /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i
        );
      if (ogImg?.[1]) image = ogImg[1];
    }

    // --- Fallback: og:title for title + year ---
    if (!title) {
      const ogTitle =
        html.match(
          /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i
        ) ||
        html.match(
          /<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i
        );
      if (ogTitle?.[1]) {
        let raw = ogTitle[1]
          .replace(/\s*-\s*IMDb\s*$/i, "")
          .replace(/\s*⭐.*$/, "")
          .replace(/\s*&#x2B50;.*$/, "")
          .trim();

        // Extract year from "(1999)" or "(TV Series 1989–1998)"
        const plainYear = raw.match(/\((\d{4})\)/);
        const tvYear = raw.match(
          /\((?:TV Episode|TV Series|TV Movie|TV Special|TV Mini Series|Short)\s+(\d{4})/
        );
        if (tvYear) {
          if (!year) year = parseInt(tvYear[1], 10);
          raw = raw
            .replace(
              /\s*\((?:TV Episode|TV Series|TV Movie|TV Special|TV Mini Series|Short)\s+\d{4}[^)]*\)\s*/,
              " "
            )
            .trim();
        } else if (plainYear) {
          if (!year) year = parseInt(plainYear[1], 10);
          raw = raw.replace(/\s*\(\d{4}\)\s*/, " ").trim();
        }

        title = raw || title;
      }
    }

    // Filter out placeholder images
    if (image && (image.includes("nopicture") || image.includes("no_photo"))) {
      image = null;
    }

    console.log(`[IMDB Preview] Result: "${title}" (${year}) [${type}] rating=${rating} image=${image ? "yes" : "no"}`);

    return NextResponse.json({
      title,
      year,
      type,
      rating,
      image,
    });
  } catch (error) {
    console.error("[IMDB Preview] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
