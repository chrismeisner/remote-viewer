import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type ImdbCandidate = {
  imdbUrl: string;
  title: string;
  year: number | null;
  type: string; // "film", "tv", "documentary", etc.
};

/**
 * Fetch the actual title from an IMDB page to validate it
 */
async function fetchImdbTitle(imdbUrl: string): Promise<{ title: string | null; year: number | null }> {
  try {
    const response = await fetch(imdbUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return { title: null, year: null };

    const html = await response.text();

    const ogTitleMatch =
      html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);

    let title: string | null = null;
    let year: number | null = null;

    if (ogTitleMatch) {
      let rawTitle = ogTitleMatch[1].replace(/\s*-\s*IMDb\s*$/i, "").trim();
      const yearMatch = rawTitle.match(/\((\d{4})\)/);
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        rawTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/, " ").trim();
      }
      title = rawTitle;
    }

    if (!title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        let rawTitle = titleMatch[1].replace(/\s*-\s*IMDb\s*$/i, "").trim();
        const yearMatch = rawTitle.match(/\((\d{4})\)/);
        if (yearMatch) {
          year = parseInt(yearMatch[1], 10);
          rawTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/, " ").trim();
        }
        title = rawTitle;
      }
    }

    return { title, year };
  } catch {
    return { title: null, year: null };
  }
}

/**
 * POST /api/media-metadata/imdb-search
 *
 * Uses OpenAI to find multiple possible IMDB URLs for a media item.
 *
 * Body:
 *   - filename: string
 *   - title?: string (existing title if known)
 *   - year?: number (existing year if known)
 *   - type?: string (film, tv, etc.)
 *
 * Returns:
 *   - candidates: ImdbCandidate[]
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { filename, title, year, type, director, category, season, episode } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Step 1: Perform actual Google search to find IMDB URLs
    const searchQuery = title
      ? `site:imdb.com "${title}" ${year || ""} ${director?.split(',')[0].trim() || ""}`.trim()
      : `site:imdb.com ${filename.replace(/[._-]/g, ' ').replace(/\.(mp4|mkv|avi|mov)$/i, '')}`;

    console.log(`[IMDB Search] Google search query: ${searchQuery}`);

    let googleResults: { url: string; title: string }[] = [];
    
    try {
      // Use Google Custom Search API or scrape Google results
      const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&num=10`;
      const response = await fetch(googleSearchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const html = await response.text();
        // Extract IMDB URLs from search results
        const imdbUrlPattern = /https?:\/\/www\.imdb\.com\/title\/tt\d{7,8}\//g;
        const matches = html.match(imdbUrlPattern);
        
        if (matches) {
          const uniqueUrls = [...new Set(matches)];
          googleResults = uniqueUrls.slice(0, 5).map(url => ({ url, title: "" }));
          console.log(`[IMDB Search] Found ${googleResults.length} IMDB URLs from Google`);
        }
      }
    } catch (error) {
      console.warn("[IMDB Search] Google search failed, falling back to AI:", error);
    }

    // Step 2: Use OpenAI to refine and rank results, or generate if Google failed
    const systemPrompt = `You are an IMDB search assistant. ${
      googleResults.length > 0
        ? "You are provided with IMDB URLs from Google search results. Analyze each URL and return them ranked by relevance."
        : "Given media metadata, return the most likely IMDB matches based on your knowledge."
    }

Your response MUST be a valid JSON array of objects with these fields:
[
  {
    "imdbUrl": "https://www.imdb.com/title/tt0133093/",
    "title": "The Matrix",
    "year": 1999,
    "type": "film"
  }
]

Rules:
- Return 2-5 candidates ordered by most likely match first
- "imdbUrl" MUST be a valid IMDB URL in the format "https://www.imdb.com/title/ttXXXXXXX/"
- "title" should be the proper title as shown on IMDB
- "year" should be the release year (number or null)
- "type" should be one of: "film", "tv", "documentary", "sports", "concert", "other"
- For TV shows, use the URL for the series page, not a specific episode
- ${googleResults.length > 0 ? "Analyze the provided URLs and determine which best match the media. Remove irrelevant results." : "Make sure IMDB IDs are accurate based on your training data. Do NOT make up IDs."}
- Include remakes/alternative versions if relevant
- Only return valid JSON, nothing else`;

    let userPrompt = `Find the best IMDB matches for:

Filename: ${filename}`;

    if (title) userPrompt += `\nTitle: ${title}`;
    if (year) userPrompt += `\nYear: ${year}`;
    if (type) userPrompt += `\nType: ${type}`;
    if (director) userPrompt += `\nDirector/Creator: ${director}`;
    if (category) userPrompt += `\nCategory/Genre: ${category}`;
    if (season) userPrompt += `\nSeason: ${season}`;
    if (episode) userPrompt += `\nEpisode: ${episode}`;

    if (googleResults.length > 0) {
      userPrompt += `\n\nGoogle found these IMDB URLs (in order of appearance):\n`;
      googleResults.forEach((result, i) => {
        userPrompt += `${i + 1}. ${result.url}\n`;
      });
      userPrompt += `\nAnalyze these URLs and return the ones that best match the media, ranked by relevance.`;
    }

    console.log(`[IMDB Search] Searching with AI for: ${filename} (title: ${title}, year: ${year})`);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 1024,
      temperature: 0.2,
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    console.log(`[IMDB Search] Raw response: ${content}`);

    // Parse the JSON array response
    let parsed: ImdbCandidate[];
    try {
      const jsonString = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      parsed = JSON.parse(jsonString);
    } catch {
      console.error("[IMDB Search] Failed to parse JSON:", content);
      return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
    }

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid AI response format" }, { status: 500 });
    }

    // Validate and normalize each candidate
    const imdbPattern = /^https?:\/\/(www\.)?imdb\.com\/title\/tt\d{7,8}\/?$/i;
    const validCandidates: ImdbCandidate[] = [];

    for (const candidate of parsed.slice(0, 5)) {
      if (!candidate.imdbUrl || typeof candidate.imdbUrl !== "string") continue;

      const urlTrimmed = candidate.imdbUrl.trim();
      if (!imdbPattern.test(urlTrimmed)) continue;

      // Normalize URL
      const idMatch = urlTrimmed.match(/tt\d{7,8}/);
      if (!idMatch) continue;

      const normalizedUrl = `https://www.imdb.com/title/${idMatch[0]}/`;

      validCandidates.push({
        imdbUrl: normalizedUrl,
        title: typeof candidate.title === "string" ? candidate.title.trim() : "Unknown",
        year:
          typeof candidate.year === "number" && candidate.year >= 1800 && candidate.year <= 2100
            ? candidate.year
            : null,
        type: typeof candidate.type === "string" ? candidate.type : "film",
      });
    }

    // Validate top candidates by actually fetching the IMDB pages (in parallel, limit to 3)
    const toValidate = validCandidates.slice(0, 3);
    const validationResults = await Promise.allSettled(
      toValidate.map(async (candidate) => {
        const { title: actualTitle, year: actualYear } = await fetchImdbTitle(candidate.imdbUrl);
        return { imdbUrl: candidate.imdbUrl, actualTitle, actualYear };
      })
    );

    // Merge validation results back
    for (const result of validationResults) {
      if (result.status === "fulfilled" && result.value.actualTitle) {
        const candidate = validCandidates.find((c) => c.imdbUrl === result.value.imdbUrl);
        if (candidate) {
          // Update with the actual IMDB title/year for accuracy
          candidate.title = result.value.actualTitle;
          if (result.value.actualYear) candidate.year = result.value.actualYear;
        }
      }
    }

    // Filter out candidates where IMDB returned nothing (dead links)
    const finalCandidates = validCandidates.filter((candidate) => {
      const validation = validationResults.find(
        (r) => r.status === "fulfilled" && r.value.imdbUrl === candidate.imdbUrl
      );
      // Keep validated ones that had a title, plus un-validated ones (4th, 5th)
      if (validation && validation.status === "fulfilled") {
        return validation.value.actualTitle !== null;
      }
      return true; // Keep un-validated extras
    });

    console.log(`[IMDB Search] Returning ${finalCandidates.length} candidates`);

    return NextResponse.json({ candidates: finalCandidates });
  } catch (error) {
    console.error("[IMDB Search] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
