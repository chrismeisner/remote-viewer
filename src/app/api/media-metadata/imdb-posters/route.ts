import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Normalize an IMDB Amazon image URL to its canonical base form,
 * stripping any _V1_ resize/crop parameters.
 * e.g. "https://m.media-amazon.com/images/M/MV5B...@._V1_QL75_UX300_.jpg"
 *    → "https://m.media-amazon.com/images/M/MV5B...@"
 */
function getImageBase(url: string): string {
  return url.replace(/\._V1_.*$/, "");
}

/**
 * Resize an IMDB/Amazon image URL to a specific width.
 * IMDB image URLs support dynamic resizing via the _V1_ suffix parameters.
 */
function resizeImdbImage(url: string, width: number): string {
  const base = getImageBase(url);
  return `${base}._V1_QL75_UX${width}_.jpg`;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

type PosterResult = {
  url: string;
  thumbnail: string;
  caption: string;
};

/**
 * GET /api/media-metadata/imdb-posters?id=tt0163651
 *
 * Fetches all available poster/cover images for an IMDB title by scraping
 * the media index page (/title/{id}/mediaindex/) which lists all photos.
 *
 * Falls back to the main title page if the media index is unavailable.
 *
 * Returns:
 *   - posters: PosterResult[] — array of poster images with URLs and thumbnails
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

    const posters: PosterResult[] = [];
    const seenBases = new Set<string>();

    // Helper to add a poster if we haven't seen its base URL before
    const addPoster = (imageUrl: string, caption: string) => {
      const base = getImageBase(imageUrl);
      if (seenBases.has(base)) return;
      if (base.includes("nopicture") || base.includes("no_photo")) return;
      seenBases.add(base);
      posters.push({
        url: `${base}._V1_.jpg`, // Full resolution
        thumbnail: resizeImdbImage(imageUrl, 300), // 300px wide thumbnail
        caption,
      });
    };

    // --- Strategy 1: Fetch the media index page (has all gallery images) ---
    const mediaIndexUrl = `https://www.imdb.com/title/${titleId}/mediaindex/`;
    console.log(`[IMDB Posters] Fetching media index: ${mediaIndexUrl}`);

    try {
      const indexResponse = await fetch(mediaIndexUrl, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (indexResponse.ok) {
        const indexHtml = await indexResponse.text();

        // Extract <img> tags with Amazon image URLs and alt text
        // Pattern 1: alt before src
        const pattern1 =
          /<img[^>]+alt="([^"]*?)"[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/M\/[^"]+)"/g;
        // Pattern 2: src before alt
        const pattern2 =
          /<img[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/M\/[^"]+)"[^>]+alt="([^"]*?)"/g;

        let match: RegExpExecArray | null;

        while ((match = pattern1.exec(indexHtml)) !== null) {
          addPoster(match[2], match[1]);
        }
        while ((match = pattern2.exec(indexHtml)) !== null) {
          addPoster(match[1], match[2]);
        }

        console.log(
          `[IMDB Posters] Found ${posters.length} images from media index page`
        );
      } else {
        console.warn(
          `[IMDB Posters] Media index returned ${indexResponse.status}, falling back to title page`
        );
      }
    } catch (err) {
      console.warn("[IMDB Posters] Media index fetch failed:", err);
    }

    // --- Strategy 2: Fallback to main title page if media index yielded nothing ---
    if (posters.length === 0) {
      const titleUrl = `https://www.imdb.com/title/${titleId}/`;
      console.log(`[IMDB Posters] Falling back to title page: ${titleUrl}`);

      const titleResponse = await fetch(titleUrl, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (!titleResponse.ok) {
        return NextResponse.json(
          { error: `IMDB returned ${titleResponse.status}` },
          { status: 502 }
        );
      }

      const titleHtml = await titleResponse.text();

      // Try __NEXT_DATA__ for primary image and gallery
      const nextDataMatch = titleHtml.match(
        /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/i
      );

      if (nextDataMatch?.[1]) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          const aboveTheFold = nextData?.props?.pageProps?.aboveTheFoldData;
          const mainColumn = nextData?.props?.pageProps?.mainColumnData;

          // Primary image
          if (aboveTheFold?.primaryImage?.url) {
            addPoster(
              aboveTheFold.primaryImage.url,
              aboveTheFold.primaryImage.caption?.plainText || "Primary poster"
            );
          }

          // Gallery images from titleMainImages
          const titleMainImages = mainColumn?.titleMainImages;
          if (titleMainImages?.edges) {
            for (const edge of titleMainImages.edges) {
              const node = edge?.node;
              if (node?.url) {
                addPoster(
                  node.url,
                  node.caption?.plainText || ""
                );
              }
            }
          }

          console.log(
            `[IMDB Posters] Found ${posters.length} images from title page __NEXT_DATA__`
          );
        } catch (e) {
          console.warn("[IMDB Posters] Failed to parse __NEXT_DATA__:", e);
        }
      }

      // Also try extracting <img> tags from the title page
      if (posters.length <= 1) {
        const pattern1 =
          /<img[^>]+alt="([^"]*?)"[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/M\/[^"]+)"/g;
        const pattern2 =
          /<img[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/M\/[^"]+)"[^>]+alt="([^"]*?)"/g;

        let match: RegExpExecArray | null;

        while ((match = pattern1.exec(titleHtml)) !== null) {
          addPoster(match[2], match[1]);
        }
        while ((match = pattern2.exec(titleHtml)) !== null) {
          addPoster(match[1], match[2]);
        }

        console.log(
          `[IMDB Posters] Found ${posters.length} total images after HTML extraction`
        );
      }

      // Final fallback: og:image / JSON-LD
      if (posters.length === 0) {
        const jsonLdMatch = titleHtml.match(
          /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
        );
        if (jsonLdMatch?.[1]) {
          try {
            const ld = JSON.parse(jsonLdMatch[1]);
            const imgUrl =
              typeof ld.image === "string" ? ld.image : ld.image?.url;
            if (imgUrl) addPoster(imgUrl, ld.name || "Poster");
          } catch {
            // ignore
          }
        }

        const ogImageMatch =
          titleHtml.match(
            /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i
          ) ||
          titleHtml.match(
            /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i
          );
        if (ogImageMatch?.[1]) {
          addPoster(ogImageMatch[1], "IMDB poster");
        }
      }
    }

    console.log(
      `[IMDB Posters] Returning ${posters.length} posters for ${titleId}`
    );

    return NextResponse.json({
      posters,
      titleId,
    });
  } catch (error) {
    console.error("[IMDB Posters] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
