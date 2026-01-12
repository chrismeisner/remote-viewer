import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type AiLookupResponse = {
  title?: string;
  year?: number | null;
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: string | null;
  season?: number | null;
  episode?: number | null;
};

/**
 * POST /api/media-metadata/ai-lookup
 * 
 * Uses OpenAI to identify media from a filename and return structured metadata.
 * 
 * Body:
 *   - filename: string (the filename to analyze)
 *   - existingMetadata?: { title?, year?, director?, category?, makingOf?, plot?, type?, season?, episode? } (optional existing data for context)
 *   - maxTokens?: number (optional, default 512, controls response detail level)
 * 
 * Returns:
 *   - title: string
 *   - year: number | null
 *   - director: string | null
 *   - category: string | null
 *   - makingOf: string | null
 *   - plot: string | null
 *   - type: "film" | "tv" | "documentary" | "other" | null
 *   - season: number | null
 *   - episode: number | null
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
    const { filename, existingMetadata, maxTokens = 512 } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "filename is required" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const systemPrompt = `You are a media identification assistant. Given a filename, identify the movie, TV show, documentary, or other media and return structured metadata.

Your response MUST be valid JSON with exactly these fields:
{
  "title": "The proper title of the media",
  "year": 1999,
  "director": "Director or creator name",
  "category": "Genre category like Drama, Comedy, Sci-Fi, Documentary, etc.",
  "makingOf": "Who made it, actors, production facts, behind-the-scenes info",
  "plot": "A short summary of this specific movie or episode's plot",
  "type": "film",
  "season": null,
  "episode": null
}

Rules:
- "title" should be the clean, official title (e.g., "The Matrix" not "The.Matrix.1999.1080p")
- "year" should be the release year as a number, or null if unknown
- "director" should be the director for movies, creator/showrunner for TV shows, or null if unknown
- "category" should be a simple genre like "Action", "Comedy", "Drama", "Sci-Fi", "Horror", "Documentary", "Animation", "Thriller", etc. Use the most fitting single category or two combined with "/"
- "makingOf" should focus on the PEOPLE and PRODUCTION: list the main actors/cast members, who directed and produced it, interesting behind-the-scenes facts, production challenges, filming locations, budget info, box office performance, awards won, and any notable trivia about the making of the media. This is about WHO made it and HOW, not what the story is about.
- "plot" should be a short summary of THIS SPECIFIC content's plot/story. For TV episodes, describe what happens in this particular episode. For movies, describe the movie's storyline. Always try to provide a plot summary.
- "type" MUST be one of: "film" (for movies), "tv" (for TV shows/series), "documentary" (for documentaries), or "other" (for everything else like concerts, stand-up specials, etc.)
- "season" should be the season number as an integer for TV shows, or null for non-TV content
- "episode" should be the episode number as an integer for TV shows, or null for non-TV content

TV Episode Detection:
- Look for patterns like "S01E01", "S02E08", "s1e5", "S03E12" in filenames - these indicate Season and Episode numbers
- "S02E08" means Season 2 Episode 8, "S01E01" means Season 1 Episode 1, etc.
- For TV episodes, set type to "tv", extract the season and episode numbers, and use the year when that specific SEASON aired (not the show's premiere year)
- The title should be the show name (e.g., "The Simpsons" not "The Simpsons S02E01")
- The makingOf should mention the main cast, creators, and any interesting production facts
- The plot should describe what happens in THIS SPECIFIC EPISODE

General:
- If you cannot identify the media, make your best guess based on the filename
- If existing metadata is provided, use it as a hint but verify/correct if needed
- Always return valid JSON, nothing else`;

    // Build user prompt with existing metadata context if available
    let userPrompt = `Identify this media file and return the metadata as JSON:

Filename: ${filename}`;

    // Add existing metadata as context if any fields are present
    const existingFields: string[] = [];
    if (existingMetadata) {
      if (existingMetadata.title) existingFields.push(`Title: ${existingMetadata.title}`);
      if (existingMetadata.year) existingFields.push(`Year: ${existingMetadata.year}`);
      if (existingMetadata.director) existingFields.push(`Director: ${existingMetadata.director}`);
      if (existingMetadata.category) existingFields.push(`Category: ${existingMetadata.category}`);
      if (existingMetadata.makingOf) existingFields.push(`Making Of: ${existingMetadata.makingOf}`);
      if (existingMetadata.plot) existingFields.push(`Plot: ${existingMetadata.plot}`);
      if (existingMetadata.type) existingFields.push(`Type: ${existingMetadata.type}`);
      if (existingMetadata.season) existingFields.push(`Season: ${existingMetadata.season}`);
      if (existingMetadata.episode) existingFields.push(`Episode: ${existingMetadata.episode}`);
    }
    
    if (existingFields.length > 0) {
      userPrompt += `

Existing metadata (use as context, verify and fill in missing fields):
${existingFields.join("\n")}`;
    }

    // Clamp maxTokens to reasonable range
    const tokenLimit = Math.min(Math.max(Number(maxTokens) || 512, 128), 2048);
    
    console.log(`[AI Lookup] Analyzing filename: ${filename} (maxTokens: ${tokenLimit})`);

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
    const validTypes = ["film", "tv", "documentary", "other"];
    const result = {
      title: typeof parsed.title === "string" ? parsed.title.trim() : null,
      year: typeof parsed.year === "number" && parsed.year >= 1800 && parsed.year <= 2100 
        ? parsed.year 
        : null,
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
        ? parsed.type.toLowerCase() as "film" | "tv" | "documentary" | "other"
        : null,
      season: typeof parsed.season === "number" && Number.isInteger(parsed.season) && parsed.season > 0
        ? parsed.season
        : null,
      episode: typeof parsed.episode === "number" && Number.isInteger(parsed.episode) && parsed.episode > 0
        ? parsed.episode
        : null,
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
