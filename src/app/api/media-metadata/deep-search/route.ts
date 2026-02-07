import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type DeepSearchRequest = {
  filename: string;
  existingMetadata: {
    title?: string | null;
    year?: number | null;
    releaseDate?: string | null;
    director?: string | null;
    category?: string | null;
    makingOf?: string | null;
    plot?: string | null;
    type?: string | null;
    season?: number | null;
    episode?: number | null;
    imdbUrl?: string | null;
    tags?: string[] | null;
  };
};

type DeepSearchResponse = {
  title?: string;
  year?: number | null;
  releaseDate?: string | null;
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: "film" | "tv" | "documentary" | "sports" | "concert" | "other" | null;
  season?: number | null;
  episode?: number | null;
  imdbUrl?: string | null;
  tags?: string[] | null;
};

/**
 * POST /api/media-metadata/deep-search
 *
 * Uses OpenAI (gpt-4o) to do a thorough, context-rich metadata lookup.
 * Unlike the regular ai-lookup which primarily works from the filename,
 * deep-search leverages ALL existing metadata to do a highly targeted
 * search — e.g. looking up the specific plot of a TV episode, detailed
 * game stats for a sporting event, setlist for a concert, etc.
 *
 * Body:
 *   - filename: string
 *   - existingMetadata: object with all known metadata fields
 *
 * Returns the same shape as ai-lookup but with richer, more specific data.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const body: DeepSearchRequest = await request.json();
    const { filename, existingMetadata } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "filename is required" },
        { status: 400 }
      );
    }

    if (!existingMetadata || typeof existingMetadata !== "object") {
      return NextResponse.json(
        { error: "existingMetadata is required for deep search" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Build a rich context section from existing metadata
    const contextLines: string[] = [];
    if (existingMetadata.title) contextLines.push(`Title: ${existingMetadata.title}`);
    if (existingMetadata.year) contextLines.push(`Year: ${existingMetadata.year}`);
    if (existingMetadata.releaseDate) contextLines.push(`Release Date: ${existingMetadata.releaseDate}`);
    if (existingMetadata.director) contextLines.push(`Director/Creator: ${existingMetadata.director}`);
    if (existingMetadata.category) contextLines.push(`Category/Genre: ${existingMetadata.category}`);
    if (existingMetadata.type) contextLines.push(`Media Type: ${existingMetadata.type}`);
    if (existingMetadata.season) contextLines.push(`Season: ${existingMetadata.season}`);
    if (existingMetadata.episode) contextLines.push(`Episode: ${existingMetadata.episode}`);
    if (existingMetadata.imdbUrl) contextLines.push(`IMDB URL: ${existingMetadata.imdbUrl}`);
    if (existingMetadata.makingOf) contextLines.push(`Current Making-Of: ${existingMetadata.makingOf}`);
    if (existingMetadata.plot) contextLines.push(`Current Plot: ${existingMetadata.plot}`);
    if (existingMetadata.tags?.length) contextLines.push(`Tags: ${existingMetadata.tags.join(", ")}`);

    const mediaType = existingMetadata.type || "unknown";
    const isTv = mediaType === "tv";
    const isSports = mediaType === "sports";
    const isConcert = mediaType === "concert";
    const isFilm = mediaType === "film";
    const isDocumentary = mediaType === "documentary";

    // Build type-specific deep search instructions
    let typeSpecificInstructions = "";

    if (isTv && existingMetadata.title && existingMetadata.season && existingMetadata.episode) {
      typeSpecificInstructions = `
THIS IS A TV EPISODE. You must research the SPECIFIC episode:
- Show: "${existingMetadata.title}"
- Season ${existingMetadata.season}, Episode ${existingMetadata.episode}
${existingMetadata.imdbUrl ? `- IMDB: ${existingMetadata.imdbUrl}` : ""}

DEEP SEARCH REQUIREMENTS FOR THIS TV EPISODE:
1. "plot" — Write a DETAILED plot summary for THIS SPECIFIC EPISODE (Season ${existingMetadata.season}, Episode ${existingMetadata.episode}). Not the show overview — describe what happens in THIS episode with key plot points, character arcs, and the resolution. Include the episode title if known. Aim for 3-5 sentences.
2. "makingOf" — List the MAIN CAST of the show with their character names (e.g., "Bryan Cranston as Walter White"). Also include: the episode's director and writer if known, notable guest stars in this episode, any interesting behind-the-scenes facts about this specific episode, production details, awards this episode won.
3. "releaseDate" — The original AIR DATE of this specific episode in YYYY-MM-DD format.
4. "director" — The director of THIS SPECIFIC EPISODE (not the show creator).
5. "tags" — Include: main actor names, guest star names, episode title, notable themes or topics in this episode, the show creator's name.
6. "category" — The genre(s) of the show.
7. "title" — Keep the show title as-is: "${existingMetadata.title}".
8. "year" — The year THIS SPECIFIC EPISODE aired (which may differ from the show's premiere year).`;
    } else if (isSports) {
      typeSpecificInstructions = `
THIS IS A SPORTING EVENT.
${existingMetadata.title ? `- Event: "${existingMetadata.title}"` : ""}
${existingMetadata.releaseDate ? `- Date: ${existingMetadata.releaseDate}` : ""}
${existingMetadata.category ? `- Sport: ${existingMetadata.category}` : ""}

DEEP SEARCH REQUIREMENTS FOR THIS SPORTING EVENT:
1. "plot" — Write a DETAILED game/match summary with:
   - Final score
   - Quarter-by-quarter / period-by-period / inning-by-inning breakdown
   - Standout player performances WITH DETAILED STATS (points, rebounds, assists, yards, TDs, goals, saves, etc.)
   - Key plays, momentum shifts, and turning points
   - Records broken or milestones reached
   - How the game ended (dramatic finish? blowout?)
   - Post-game significance (playoff implications, standings impact)
2. "makingOf" — Include: full rosters/starters for both teams, head coaches, venue name and location, attendance, broadcast network and commentators, significance of the matchup (rivalry, playoff seeding, streaks), any pre-game storylines.
3. "releaseDate" — The EXACT date of the game in YYYY-MM-DD format.
4. "tags" — Include: key player names (both teams), coach names, venue name, league name, broadcast network, any special designations (playoff, finals, all-star, etc.).
5. "director" — The lead broadcaster/commentator(s) if known.`;
    } else if (isConcert) {
      typeSpecificInstructions = `
THIS IS A CONCERT/LIVE PERFORMANCE.
${existingMetadata.title ? `- Performance: "${existingMetadata.title}"` : ""}
${existingMetadata.releaseDate ? `- Date: ${existingMetadata.releaseDate}` : ""}
${existingMetadata.category ? `- Genre: ${existingMetadata.category}` : ""}

DEEP SEARCH REQUIREMENTS FOR THIS CONCERT:
1. "plot" — Write a DETAILED description of THIS SPECIFIC SHOW:
   - Full or partial SETLIST (list the songs performed in order if known)
   - Highlights and standout performances of specific songs
   - Memorable moments (audience interaction, improvisation, technical issues)
   - Special guests who joined on stage
   - Encores and how the show ended
   - Audience and critical reception
   - Historical significance (was this a legendary show? first/last performance of a song? farewell tour?)
2. "makingOf" — Include: band lineup for this specific show (all members with instruments), opening act(s), tour name and which leg, venue details (name, city, capacity), stage/production design, was this officially recorded/filmed and released? Technical crew if notable.
3. "releaseDate" — The EXACT date of the performance in YYYY-MM-DD format.
4. "tags" — Include: band member names, opening act names, venue name, city, tour name, notable songs performed, genre tags.
5. "director" — The tour/musical director or the director of the filmed version if applicable.`;
    } else if (isFilm) {
      typeSpecificInstructions = `
THIS IS A FILM/MOVIE.
${existingMetadata.title ? `- Title: "${existingMetadata.title}"` : ""}
${existingMetadata.year ? `- Year: ${existingMetadata.year}` : ""}
${existingMetadata.director ? `- Director: ${existingMetadata.director}` : ""}

DEEP SEARCH REQUIREMENTS FOR THIS FILM:
1. "plot" — Write a DETAILED plot summary (4-6 sentences). Cover the setup, rising action, key turning points, and resolution. Avoid single-sentence summaries.
2. "makingOf" — Include: FULL main cast with character names (e.g., "Tom Hanks as Forrest Gump"), director, producers, screenwriter, cinematographer, composer. Also include: budget, box office gross, filming locations, production challenges, awards won (especially Academy Awards), interesting behind-the-scenes trivia.
3. "releaseDate" — The theatrical release date in YYYY-MM-DD format (US release preferred).
4. "tags" — Include: actor names, director name, character names, themes, filming locations, awards, notable keywords.
5. "category" — Specific genre(s) of the film.`;
    } else if (isDocumentary) {
      typeSpecificInstructions = `
THIS IS A DOCUMENTARY.
${existingMetadata.title ? `- Title: "${existingMetadata.title}"` : ""}
${existingMetadata.year ? `- Year: ${existingMetadata.year}` : ""}

DEEP SEARCH REQUIREMENTS FOR THIS DOCUMENTARY:
1. "plot" — Write a DETAILED summary of what this documentary covers (4-6 sentences). What is the subject matter? What perspectives are presented? What conclusions does it draw?
2. "makingOf" — Include: director, producers, narrator(s), featured interviewees/subjects, production company, filming locations, festivals screened at, awards, distribution (theatrical, streaming, TV).
3. "releaseDate" — The release date in YYYY-MM-DD format.
4. "tags" — Include: subject matter keywords, featured people, director, production company, themes.`;
    } else {
      typeSpecificInstructions = `
Research this media thoroughly and fill in all metadata fields with as much detail as possible.
1. "plot" — Detailed description of the content (4-6 sentences).
2. "makingOf" — Key people involved (cast, crew, creators) with specific roles, plus production details.
3. "tags" — Relevant keywords: people, themes, locations, genres.`;
    }

    const systemPrompt = `You are an expert media research assistant performing a DEEP SEARCH. You have been given existing metadata about a piece of media, and your job is to research it thoroughly and return ENRICHED, DETAILED metadata.

Unlike a basic lookup, you should:
- Use ALL the provided context (title, year, type, season, episode, IMDB URL, etc.) to identify the EXACT piece of media
- Look up SPECIFIC details — not generic show/series info, but details about THIS SPECIFIC episode/game/concert/film
- Provide DETAILED, RICH responses for plot and makingOf fields
- Fill in any missing fields with accurate data
- Correct any existing errors you notice
- Add relevant tags (actor names, themes, keywords)

Your response MUST be valid JSON with these fields:
{
  "title": "The proper title",
  "year": 1999,
  "releaseDate": "1999-03-31",
  "director": "Director name",
  "category": "Genre",
  "makingOf": "Detailed production info, cast, crew, behind-the-scenes",
  "plot": "Detailed plot/content summary",
  "type": "film",
  "season": null,
  "episode": null,
  "imdbUrl": "https://www.imdb.com/title/tt0133093/",
  "tags": ["actor1", "actor2", "theme1", "keyword1"]
}

Rules:
- "type" MUST be one of: "film", "tv", "documentary", "sports", "concert", "other"
- "tags" should be an array of strings — include actor/player names, themes, keywords, locations
- "imdbUrl" — keep the existing one if provided and correct, or provide the correct one. Format: "https://www.imdb.com/title/ttXXXXXXX/"
- "releaseDate" must be YYYY-MM-DD format
- Always return valid JSON, nothing else
- Be THOROUGH — this is a deep search, not a quick lookup`;

    const userPrompt = `Perform a DEEP SEARCH for this media. Use all the existing metadata below to identify the EXACT content and research it thoroughly.

Filename: ${filename}

EXISTING METADATA:
${contextLines.length > 0 ? contextLines.join("\n") : "(no metadata available)"}

${typeSpecificInstructions}

Return enriched metadata as JSON. Be thorough and specific.`;

    console.log(`[Deep Search] Starting deep search for: ${filename} (type: ${mediaType})`);
    if (isTv) {
      console.log(`[Deep Search] TV Episode: "${existingMetadata.title}" S${existingMetadata.season}E${existingMetadata.episode}`);
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Use the full model for deep search — more thorough and accurate
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 2048, // Higher limit for detailed responses
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "No response from AI" },
        { status: 500 }
      );
    }

    console.log(`[Deep Search] Raw response length: ${content.length} chars`);

    // Parse the JSON response
    let parsed: DeepSearchResponse;
    try {
      const jsonString = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("[Deep Search] Failed to parse JSON:", content);
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    // Validate and clean up
    const validTypes = ["film", "tv", "documentary", "sports", "concert", "other"];

    // Validate releaseDate
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

    // Validate tags
    let parsedTags: string[] | null = null;
    if (Array.isArray(parsed.tags) && parsed.tags.length > 0) {
      parsedTags = parsed.tags.filter(
        (t): t is string => typeof t === "string" && t.trim().length > 0
      ).map(t => t.trim());
      if (parsedTags.length === 0) parsedTags = null;
    }

    const result = {
      title: typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : existingMetadata.title || null,
      year: typeof parsed.year === "number" && parsed.year >= 1800 && parsed.year <= 2100
        ? parsed.year
        : existingMetadata.year || null,
      releaseDate: parsedReleaseDate || existingMetadata.releaseDate || null,
      director: typeof parsed.director === "string" && parsed.director.trim()
        ? parsed.director.trim()
        : existingMetadata.director || null,
      category: typeof parsed.category === "string" && parsed.category.trim()
        ? parsed.category.trim()
        : existingMetadata.category || null,
      makingOf: typeof parsed.makingOf === "string" && parsed.makingOf.trim()
        ? parsed.makingOf.trim()
        : existingMetadata.makingOf || null,
      plot: typeof parsed.plot === "string" && parsed.plot.trim()
        ? parsed.plot.trim()
        : existingMetadata.plot || null,
      type: typeof parsed.type === "string" && validTypes.includes(parsed.type.toLowerCase())
        ? (parsed.type.toLowerCase() as DeepSearchResponse["type"])
        : (existingMetadata.type as DeepSearchResponse["type"]) || null,
      season: typeof parsed.season === "number" && Number.isInteger(parsed.season) && parsed.season > 0
        ? parsed.season
        : existingMetadata.season || null,
      episode: typeof parsed.episode === "number" && Number.isInteger(parsed.episode) && parsed.episode > 0
        ? parsed.episode
        : existingMetadata.episode || null,
      imdbUrl: typeof parsed.imdbUrl === "string" && /^https?:\/\/(www\.)?imdb\.com\/title\/tt\d{7,8}\/?$/i.test(parsed.imdbUrl.trim())
        ? parsed.imdbUrl.trim()
        : existingMetadata.imdbUrl || null,
      tags: parsedTags || existingMetadata.tags || null,
    };

    console.log(`[Deep Search] Result:`, {
      title: result.title,
      year: result.year,
      type: result.type,
      plotLength: result.plot?.length || 0,
      makingOfLength: result.makingOf?.length || 0,
      tagsCount: result.tags?.length || 0,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Deep Search] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
