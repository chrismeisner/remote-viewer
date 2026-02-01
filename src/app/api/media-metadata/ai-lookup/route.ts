import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

/**
 * Normalize a title for comparison:
 * - lowercase
 * - remove special characters and extra whitespace
 * - remove common suffixes like year in parentheses
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(\d{4}\)/g, "") // Remove year in parentheses like "(1999)"
    .replace(/[^\w\s]/g, " ") // Replace special chars with space
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

/**
 * Calculate similarity between two strings (simple Jaccard-like approach)
 * Returns a value between 0 and 1
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeTitle(str1);
  const s2 = normalizeTitle(str2);
  
  // Exact match after normalization
  if (s1 === s2) return 1;
  
  // Check if one contains the other (for cases like "The Matrix" vs "The Matrix (1999)")
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  // Word-based comparison
  const words1 = new Set(s1.split(" ").filter(w => w.length > 1));
  const words2 = new Set(s2.split(" ").filter(w => w.length > 1));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  // Calculate intersection
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Fetch the actual title from an IMDB page to validate it matches
 */
async function fetchImdbTitle(imdbUrl: string): Promise<{ title: string | null; year: number | null }> {
  try {
    const response = await fetch(imdbUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      console.warn(`[IMDB Validation] Failed to fetch: ${response.status}`);
      return { title: null, year: null };
    }

    const html = await response.text();

    // Extract title from og:title meta tag
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
    
    let title: string | null = null;
    let year: number | null = null;
    
    if (ogTitleMatch) {
      // og:title often looks like "The Matrix (1999) - IMDb"
      let rawTitle = ogTitleMatch[1]
        .replace(/\s*-\s*IMDb\s*$/i, "")
        .trim();
      
      // Extract year if present in title
      const yearMatch = rawTitle.match(/\((\d{4})\)/);
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        rawTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/, " ").trim();
      }
      
      title = rawTitle;
    }

    // If no og:title, try the page title
    if (!title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        let rawTitle = titleMatch[1]
          .replace(/\s*-\s*IMDb\s*$/i, "")
          .trim();
        
        const yearMatch = rawTitle.match(/\((\d{4})\)/);
        if (yearMatch) {
          year = parseInt(yearMatch[1], 10);
          rawTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/, " ").trim();
        }
        
        title = rawTitle;
      }
    }

    return { title, year };
  } catch (error) {
    console.warn("[IMDB Validation] Error fetching IMDB page:", error);
    return { title: null, year: null };
  }
}

/**
 * Validate an IMDB URL by checking if the title matches
 */
async function validateImdbUrl(
  imdbUrl: string,
  expectedTitle: string | null,
  expectedYear: number | null
): Promise<{ valid: boolean; actualTitle: string | null; similarity: number }> {
  const { title: actualTitle, year: actualYear } = await fetchImdbTitle(imdbUrl);
  
  if (!actualTitle) {
    console.log(`[IMDB Validation] Could not fetch title from IMDB`);
    return { valid: false, actualTitle: null, similarity: 0 };
  }
  
  if (!expectedTitle) {
    // No expected title to compare - accept it but with lower confidence
    console.log(`[IMDB Validation] No expected title, accepting IMDB title: "${actualTitle}"`);
    return { valid: true, actualTitle, similarity: 0.5 };
  }
  
  const similarity = calculateSimilarity(expectedTitle, actualTitle);
  console.log(`[IMDB Validation] Comparing: "${expectedTitle}" vs "${actualTitle}" - similarity: ${(similarity * 100).toFixed(1)}%`);
  
  // Also check year if both are present
  let yearMatches = true;
  if (expectedYear && actualYear && Math.abs(expectedYear - actualYear) > 1) {
    // Years are off by more than 1 year - could be a different movie/remake
    console.log(`[IMDB Validation] Year mismatch: expected ${expectedYear}, got ${actualYear}`);
    yearMatches = false;
  }
  
  // Require at least 60% title similarity AND year match (if years are available)
  const valid = similarity >= 0.6 && yearMatches;
  
  if (!valid) {
    console.log(`[IMDB Validation] REJECTED - similarity too low or year mismatch`);
  } else {
    console.log(`[IMDB Validation] ACCEPTED - good match`);
  }
  
  return { valid, actualTitle, similarity };
}

type AiLookupResponse = {
  title?: string;
  year?: number | null;
  releaseDate?: string | null; // ISO date string YYYY-MM-DD for exact release/event date
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: "film" | "tv" | "documentary" | "sports" | "concert" | "other" | null;
  season?: number | null;
  episode?: number | null;
  imdbUrl?: string | null;
};

/**
 * POST /api/media-metadata/ai-lookup
 * 
 * Uses OpenAI to identify media from a filename and return structured metadata.
 * 
 * Body:
 *   - filename: string (the filename to analyze)
 *   - existingMetadata?: { title?, year?, director?, category?, makingOf?, plot?, type?, season?, episode?, imdbUrl? } (optional existing data for context)
 *   - maxTokens?: number (optional, default 512, controls response detail level)
 *   - userContext?: string (optional user-provided context/hints to help identify the media)
 * 
 * Returns:
 *   - title: string
 *   - year: number | null
 *   - director: string | null
 *   - category: string | null
 *   - makingOf: string | null
 *   - plot: string | null
 *   - type: "film" | "tv" | "documentary" | "sports" | "concert" | "other" | null
 *   - season: number | null
 *   - episode: number | null
 *   - imdbUrl: string | null
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { filename, existingMetadata, maxTokens = 512, userContext } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "filename is required" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const systemPrompt = `You are a media identification assistant. Given a filename, identify the movie, TV show, documentary, sporting event, or other media and return structured metadata.

Your response MUST be valid JSON with exactly these fields:
{
  "title": "The proper title of the media",
  "year": 1999,
  "releaseDate": "1999-03-31",
  "director": "Director or creator name",
  "category": "Genre category like Drama, Comedy, Sci-Fi, Documentary, etc.",
  "makingOf": "Who made it, actors, production facts, behind-the-scenes info",
  "plot": "A short summary of this specific movie or episode's plot",
  "type": "film",
  "season": null,
  "episode": null,
  "imdbUrl": "https://www.imdb.com/title/tt0133093/"
}

Rules:
- "title" should be the clean, official title (e.g., "The Matrix" not "The.Matrix.1999.1080p")
- "year" should be the release year as a number, or null if unknown
- "releaseDate" should be the EXACT release date in YYYY-MM-DD format. For films, use the theatrical release date (preferably US release). For TV episodes, use the episode's air date. For sports events, use the exact date of the game/match. For concerts, use the performance date. Return null if unknown.
- "director" should be the director for movies, creator/showrunner for TV shows, or null if unknown
- "category" should be a simple genre like "Action", "Comedy", "Drama", "Sci-Fi", "Horror", "Documentary", "Animation", "Thriller", etc. Use the most fitting single category or two combined with "/"
- "makingOf" should focus on the PEOPLE and PRODUCTION: list the main actors/cast members, who directed and produced it, interesting behind-the-scenes facts, production challenges, filming locations, budget info, box office performance, awards won, and any notable trivia about the making of the media. This is about WHO made it and HOW, not what the story is about.
- "plot" should be a short summary of THIS SPECIFIC content's plot/story. For TV episodes, describe what happens in this particular episode. For movies, describe the movie's storyline. Always try to provide a plot summary.
- "type" MUST be one of: "film" (for movies), "tv" (for TV shows/series), "documentary" (for documentaries), "sports" (for sporting events, games, matches, races, etc.), "concert" (for live music performances, concerts, music festivals), or "other" (for everything else like stand-up specials, stage plays, etc.)
- "season" should be the season number as an integer for TV shows, or null for non-TV content
- "episode" should be the episode number as an integer for TV shows, or null for non-TV content
- "imdbUrl" should be the full IMDB URL for the movie or TV show (e.g., "https://www.imdb.com/title/tt0133093/" for The Matrix). The format is always "https://www.imdb.com/title/tt" followed by a 7-8 digit number. For TV shows, use the URL for the series, not a specific episode. Return null if you cannot determine the IMDB ID with confidence.

TV Episode Detection:
- Look for patterns like "S01E01", "S02E08", "s1e5", "S03E12" in filenames - these indicate Season and Episode numbers
- "S02E08" means Season 2 Episode 8, "S01E01" means Season 1 Episode 1, etc.
- For TV episodes, set type to "tv", extract the season and episode numbers, and use the year when that specific SEASON aired (not the show's premiere year)
- The title should be the show name (e.g., "The Simpsons" not "The Simpsons S02E01")
- The makingOf should mention the main cast, creators, and any interesting production facts
- The plot should describe what happens in THIS SPECIFIC EPISODE

Sports Content Detection:
- Look for DATE patterns in filenames like "02-01-1998", "1998-02-01", "02.01.1998", "020198", etc.
- Look for team names, player names, or sporting event indicators (e.g., "Bulls", "Lakers", "vs", "Game", "Championship", "Finals", "Olympics")
- If you detect a date AND sports-related terms (team names, player names, sporting events), this is likely a SPORTS recording
- For sports content, set type to "sports"
- The "title" should be the matchup or event name (e.g., "Bulls vs Lakers" or "Super Bowl XXXII")
- The "year" should be extracted from the date in the filename
- The "category" should be the sport type (e.g., "Basketball", "Football", "Baseball", "Soccer", "Hockey", "Racing", etc.)
- The "director" can be null or list notable commentators/broadcasters if known
- The "makingOf" should include: key players who participated, coaches, venue/location, significance of the game (playoff game, rivalry, etc.), notable storylines going into the game
- The "plot" should describe what happened in THIS SPECIFIC GAME with as much detail as possible:
  * Final score and how the scoring unfolded (quarter-by-quarter, inning-by-inning, etc.)
  * Standout player performances with STATS (e.g., "Michael Jordan: 35 points, 8 rebounds, 5 assists" or "Tom Brady: 28/38, 350 yards, 3 TDs")
  * Key individual achievements (career highs, records broken, milestones reached)
  * Game-changing moments and dramatic plays (game-winning shots, crucial turnovers, big defensive stops)
  * Momentum shifts and turning points
  * How the game unfolded and the final outcome
  * Post-game significance (playoff implications, records, etc.)
- Example: For "Bulls-vs-Lakers-02-01-1998", search your knowledge for details about the Bulls vs Lakers game on February 1, 1998, including player stats and standout performances

Concert/Music Performance Detection:
- Look for artist names, band names, or music-related keywords (e.g., "Live", "Concert", "Tour", "Festival", "Performance")
- Look for venue names (e.g., "Madison Square Garden", "Wembley", "Red Rocks")
- For concert content, set type to "concert"
- The "title" should be the artist/band name and tour/show name (e.g., "Pink Floyd - The Wall Live" or "Beyoncé - Renaissance World Tour")
- The "year" should be the year of the performance
- The "category" should be the music genre (e.g., "Rock", "Pop", "Hip-Hop", "Jazz", "Classical", "Electronic", etc.)
- The "director" can list the tour director, musical director, or producer if known
- The "makingOf" should include: band members/performers, backing musicians, special guests, venue information, tour context, production details, stage design, technical aspects
- The "plot" should describe: the setlist highlights, memorable performances, special moments, audience interaction, visual production elements, encore performances, and overall atmosphere of the show
- Example: For "Pink-Floyd-Live-Earls-Court-1994", provide details about the concert, setlist, and performance highlights

General:
- If you cannot identify the media, make your best guess based on the filename
- If existing metadata is provided, use it as a hint but verify/correct if needed
- Always return valid JSON, nothing else`;

    // Build user prompt with existing metadata context if available
    let userPrompt = `Identify this media file and return the metadata as JSON:

Filename: ${filename}`;

    // Add user-provided context if available
    if (userContext && typeof userContext === "string" && userContext.trim()) {
      userPrompt += `

USER-PROVIDED CONTEXT (use this information to help identify the media):
${userContext.trim()}`;
    }

    // Try to detect and highlight date patterns for sports content
    const datePatterns = [
      /(\d{2}[-_.]\d{2}[-_.]\d{4})/g,  // MM-DD-YYYY or DD-MM-YYYY
      /(\d{4}[-_.]\d{2}[-_.]\d{2})/g,  // YYYY-MM-DD
      /(\d{2}\d{2}\d{4})/g,            // MMDDYYYY or DDMMYYYY
      /(\d{4}\d{2}\d{2})/g,            // YYYYMMDD
    ];
    
    let detectedDate: string | null = null;
    for (const pattern of datePatterns) {
      const match = filename.match(pattern);
      if (match) {
        detectedDate = match[0];
        break;
      }
    }
    
    // Detect sports-related keywords
    const sportsKeywords = ['vs', 'game', 'bulls', 'lakers', 'celtics', 'patriots', 'cowboys', 
                           'yankees', 'championship', 'finals', 'playoff', 'bowl', 'cup', 
                           'match', 'race', 'fight', 'boxing', 'ufc', 'nba', 'nfl', 'mlb', 
                           'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey'];
    const lowerFilename = filename.toLowerCase();
    const hasSportsKeywords = sportsKeywords.some(keyword => lowerFilename.includes(keyword));
    
    // If we detect both a date and sports keywords, add a hint to the prompt
    if (detectedDate && hasSportsKeywords) {
      userPrompt += `

IMPORTANT: This appears to be a SPORTS recording with date: ${detectedDate}
- Extract team names, player names, and the date from the filename
- Search your knowledge for details about this specific game/event on that date
- Fill the "plot" field with comprehensive game details including:
  * Final score
  * Standout player performances WITH STATS (points, rebounds, assists, yards, touchdowns, etc.)
  * Individual achievements and milestones
  * Key plays and game-changing moments
  * How the game unfolded quarter-by-quarter/period-by-period
- Set type to "sports"`;
    }

    // Add existing metadata as context if any fields are present
    const existingFields: string[] = [];
    if (existingMetadata) {
      if (existingMetadata.title) existingFields.push(`Title: ${existingMetadata.title}`);
      if (existingMetadata.year) existingFields.push(`Year: ${existingMetadata.year}`);
      if (existingMetadata.releaseDate) existingFields.push(`Release Date: ${existingMetadata.releaseDate}`);
      if (existingMetadata.director) existingFields.push(`Director: ${existingMetadata.director}`);
      if (existingMetadata.category) existingFields.push(`Category: ${existingMetadata.category}`);
      if (existingMetadata.makingOf) existingFields.push(`Making Of: ${existingMetadata.makingOf}`);
      if (existingMetadata.plot) existingFields.push(`Plot: ${existingMetadata.plot}`);
      if (existingMetadata.type) existingFields.push(`Type: ${existingMetadata.type}`);
      if (existingMetadata.season) existingFields.push(`Season: ${existingMetadata.season}`);
      if (existingMetadata.episode) existingFields.push(`Episode: ${existingMetadata.episode}`);
      if (existingMetadata.imdbUrl) existingFields.push(`IMDB URL: ${existingMetadata.imdbUrl}`);
    }
    
    if (existingFields.length > 0) {
      userPrompt += `

Existing metadata (use as context, verify and fill in missing fields):
${existingFields.join("\n")}`;
    }

    // Clamp maxTokens to reasonable range
    const tokenLimit = Math.min(Math.max(Number(maxTokens) || 512, 128), 2048);
    
    console.log(`[AI Lookup] Analyzing filename: ${filename} (maxTokens: ${tokenLimit}${userContext ? `, userContext: "${userContext}"` : ""})`);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Fast and cost-effective for this task
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: tokenLimit,
      temperature: 0.3, // Lower temperature for more consistent outputs
    });

    const content = completion.choices[0]?.message?.content;
    
    if (!content) {
      return NextResponse.json(
        { error: "No response from AI" },
        { status: 500 }
      );
    }

    console.log(`[AI Lookup] Raw response: ${content}`);

    // Parse the JSON response
    let parsed: AiLookupResponse;
    try {
      // Clean up potential markdown code blocks
      const jsonString = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("[AI Lookup] Failed to parse JSON:", content);
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    // Validate and clean up the response
    const validTypes = ["film", "tv", "documentary", "sports", "concert", "other"];
    
    // Parse basic fields first (we need title and year for IMDB validation)
    const parsedTitle = typeof parsed.title === "string" ? parsed.title.trim() : null;
    const parsedYear = typeof parsed.year === "number" && parsed.year >= 1800 && parsed.year <= 2100 
      ? parsed.year 
      : null;
    
    // Validate IMDB URL format and verify by fetching the page
    let validatedImdbUrl: string | null = null;
    if (typeof parsed.imdbUrl === "string" && parsed.imdbUrl.trim()) {
      const imdbUrlTrimmed = parsed.imdbUrl.trim();
      // Check if it matches IMDB URL pattern
      const imdbPattern = /^https?:\/\/(www\.)?imdb\.com\/title\/tt\d{7,8}\/?$/i;
      if (imdbPattern.test(imdbUrlTrimmed)) {
        // Normalize to https://www.imdb.com/title/ttXXXXXXX/
        const idMatch = imdbUrlTrimmed.match(/tt\d{7,8}/);
        if (idMatch) {
          const normalizedUrl = `https://www.imdb.com/title/${idMatch[0]}/`;
          
          // Validate by fetching the IMDB page and comparing titles
          console.log(`[AI Lookup] Validating IMDB URL: ${normalizedUrl} against title: "${parsedTitle}" (${parsedYear})`);
          const validation = await validateImdbUrl(normalizedUrl, parsedTitle, parsedYear);
          
          if (validation.valid) {
            validatedImdbUrl = normalizedUrl;
            console.log(`[AI Lookup] IMDB URL validated successfully`);
          } else {
            console.log(`[AI Lookup] IMDB URL rejected - title mismatch. AI said "${parsedTitle}", IMDB says "${validation.actualTitle}"`);
            // Don't include the URL if validation failed
          }
        }
      }
    }
    
    // Validate and parse releaseDate
    let parsedReleaseDate: string | null = null;
    if (typeof parsed.releaseDate === "string" && parsed.releaseDate.trim()) {
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const trimmedDate = parsed.releaseDate.trim();
      if (datePattern.test(trimmedDate)) {
        const dateObj = new Date(trimmedDate);
        if (!isNaN(dateObj.getTime())) {
          parsedReleaseDate = trimmedDate;
        }
      }
    }

    const result = {
      title: parsedTitle,
      year: parsedYear,
      releaseDate: parsedReleaseDate,
      director: typeof parsed.director === "string" && parsed.director.trim() 
        ? parsed.director.trim() 
        : null,
      category: typeof parsed.category === "string" && parsed.category.trim() 
        ? parsed.category.trim() 
        : null,
      makingOf: typeof parsed.makingOf === "string" && parsed.makingOf.trim()
        ? parsed.makingOf.trim()
        : null,
      plot: typeof parsed.plot === "string" && parsed.plot.trim()
        ? parsed.plot.trim()
        : null,
      type: typeof parsed.type === "string" && validTypes.includes(parsed.type.toLowerCase())
        ? parsed.type.toLowerCase() as "film" | "tv" | "documentary" | "sports" | "concert" | "other"
        : null,
      season: typeof parsed.season === "number" && Number.isInteger(parsed.season) && parsed.season > 0
        ? parsed.season
        : null,
      episode: typeof parsed.episode === "number" && Number.isInteger(parsed.episode) && parsed.episode > 0
        ? parsed.episode
        : null,
      imdbUrl: validatedImdbUrl,
    };

    console.log(`[AI Lookup] Result:`, result);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[AI Lookup] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/media-metadata/ai-lookup
 * 
 * Check if AI lookup is available (OpenAI configured)
 */
export async function GET() {
  const configured = !!process.env.OPENAI_API_KEY;
  return NextResponse.json({ configured });
}
