import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/media-metadata/imdb-cover
 * 
 * Fetches the cover/poster image URL from an IMDB page.
 * 
 * Body:
 *   - imdbUrl: string (required) - the IMDB URL to fetch the cover from
 * 
 * Returns:
 *   - coverUrl: string - the URL to the poster image
 *   - title: string | null - the title from IMDB (for verification)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imdbUrl } = body;

    if (!imdbUrl || typeof imdbUrl !== "string") {
      return NextResponse.json(
        { error: "imdbUrl is required" },
        { status: 400 }
      );
    }

    // Validate IMDB URL format
    const imdbPattern = /^https?:\/\/(www\.)?imdb\.com\/title\/tt\d{7,8}\/?/i;
    if (!imdbPattern.test(imdbUrl)) {
      return NextResponse.json(
        { error: "Invalid IMDB URL format" },
        { status: 400 }
      );
    }

    // Normalize the URL to ensure consistent format
    const idMatch = imdbUrl.match(/tt\d{7,8}/);
    if (!idMatch) {
      return NextResponse.json(
        { error: "Could not extract IMDB ID from URL" },
        { status: 400 }
      );
    }
    const normalizedUrl = `https://www.imdb.com/title/${idMatch[0]}/`;

    console.log(`[IMDB Cover] Fetching cover from: ${normalizedUrl}`);

    // Fetch the IMDB page
    const response = await fetch(normalizedUrl, {
      headers: {
        // Use a browser-like user agent to avoid being blocked
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      console.error(`[IMDB Cover] Failed to fetch IMDB page: ${response.status}`);
      return NextResponse.json(
        { error: `Failed to fetch IMDB page: ${response.status}` },
        { status: 500 }
      );
    }

    const html = await response.text();

    // Extract the og:image meta tag (this contains the poster image)
    // Pattern: <meta property="og:image" content="URL" />
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
    
    let coverUrl: string | null = null;
    
    if (ogImageMatch && ogImageMatch[1]) {
      coverUrl = ogImageMatch[1];
      console.log(`[IMDB Cover] Found og:image: ${coverUrl}`);
    }

    // If no og:image, try to find the poster image from JSON-LD schema
    if (!coverUrl) {
      const jsonLdMatch = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (jsonLdMatch && jsonLdMatch[1]) {
        try {
          const jsonLd = JSON.parse(jsonLdMatch[1]);
          if (jsonLd.image) {
            coverUrl = typeof jsonLd.image === "string" ? jsonLd.image : jsonLd.image.url;
            console.log(`[IMDB Cover] Found image from JSON-LD: ${coverUrl}`);
          }
        } catch (e) {
          console.warn("[IMDB Cover] Failed to parse JSON-LD:", e);
        }
      }
    }

    // Extract the title for verification (from og:title)
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
    const title = ogTitleMatch ? ogTitleMatch[1].replace(/\s*-\s*IMDb\s*$/i, "").trim() : null;

    if (!coverUrl) {
      return NextResponse.json(
        { error: "Could not find cover image on IMDB page" },
        { status: 404 }
      );
    }

    // IMDB sometimes returns a placeholder image, check for that
    if (coverUrl.includes("nopicture") || coverUrl.includes("no_photo")) {
      return NextResponse.json(
        { error: "No cover image available for this title on IMDB" },
        { status: 404 }
      );
    }

    console.log(`[IMDB Cover] Success - Title: "${title}", Cover: ${coverUrl}`);

    return NextResponse.json({
      coverUrl,
      title,
      imdbId: idMatch[0],
    });
  } catch (error) {
    console.error("[IMDB Cover] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
