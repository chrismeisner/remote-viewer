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
- ALSO look for MONTH-YEAR patterns like "february-1997", "jan-2005", "march-1998" - these indicate the approximate time period
- Look for team names, player names, or sporting event indicators (e.g., "Bulls", "Lakers", "vs", "Game", "Championship", "Finals", "Olympics")
- Look for broadcast network indicators (e.g., "nba-on-tbs", "nba-on-nbc", "espn", "monday-night-football") which confirm sports content
- If you detect team names AND a date/month-year, this is likely a SPORTS recording

CRITICAL - Finding the Exact Game Date:
When you have a MONTH + YEAR but NOT an exact date (e.g., "february-1997"), you MUST research to find the exact date:
1. Think: "When did [Team A] and [Team B] play in [Month] [Year]?"
2. Recall the teams' schedules for that specific month
3. If multiple games occurred that month, consider context clues (home/away, network, etc.)
4. The releaseDate field MUST be the exact game date in YYYY-MM-DD format

Example research process for "nba-on-tbs-bulls-lakers-february-1997-720p":
- Question to answer: "When did the Bulls and Lakers play in February 1997?"
- Research: Check NBA schedule - Bulls vs Lakers games in February 1997
- Find: The game was on February 2, 1997 (or whichever date it actually was)
- Set releaseDate to: "1997-02-02"

For sports content:
- Set type to "sports"
- The "title" should be the matchup or event name (e.g., "Bulls vs Lakers" or "Super Bowl XXXII")
- The "year" should be extracted from the date in the filename
- The "releaseDate" MUST be the EXACT date of the game in YYYY-MM-DD format - research this!
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
- Example: For "nba-on-tbs-bulls-lakers-february-1997-720p", first determine WHEN in February 1997 the Bulls played the Lakers, then get the game details

Concert/Music Performance Detection:
- Look for artist names, band names, or music-related keywords (e.g., "Live", "Concert", "Tour", "Festival", "Performance", "Unplugged")
- Look for venue names (e.g., "Madison Square Garden", "Wembley", "Red Rocks", "Earls Court", "Budokan")
- ALSO look for MONTH-YEAR patterns like "october-1994", "aug-1969" - these indicate the approximate time period
- Look for year patterns even without month (e.g., "pink-floyd-1994" suggests a 1994 performance)
- For concert content, set type to "concert"

CRITICAL - Finding the Exact Concert Date:
When you have an ARTIST + VENUE but NOT an exact date, you MUST research to find the exact date:
1. Think: "When did [Artist] play at [Venue] in [Year]?"
2. Recall the artist's tour dates and history for that year
3. Cross-reference with the venue's event history
4. The releaseDate field MUST be the exact concert date in YYYY-MM-DD format

When you have an ARTIST + MONTH-YEAR pattern:
1. Think: "What [Artist] concerts happened in [Month] [Year]?"
2. Look up the artist's tour schedule for that specific time period
3. If multiple shows occurred, use venue or other context clues to identify the specific show

Example research process for "pink-floyd-earls-court-october-1994-720p":
- Question to answer: "When did Pink Floyd play at Earls Court in October 1994?"
- Research: Pink Floyd's Division Bell Tour - Earls Court residency in October 1994
- Find: They played multiple nights (Oct 13, 14, 15, 17, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29 1994)
- If filename has additional clues (night 1, final night, etc.), use that; otherwise pick the most notable/recorded show
- Set releaseDate to the specific date (e.g., "1994-10-20" for the famous recorded show)

Example research process for "nirvana-reading-festival-1992":
- Question to answer: "When did Nirvana play Reading Festival in 1992?"
- Research: Nirvana's famous Reading Festival headline set
- Find: August 30, 1992
- Set releaseDate to: "1992-08-30"

For concert content:
- The "title" should be the artist/band name and tour/show name (e.g., "Pink Floyd - The Division Bell Tour" or "Nirvana - Live at Reading 1992")
- The "year" should be the year of the performance
- The "releaseDate" MUST be the EXACT date of the concert in YYYY-MM-DD format - research this!
- The "category" should be the music genre (e.g., "Rock", "Pop", "Hip-Hop", "Jazz", "Classical", "Electronic", etc.)
- The "director" can list the tour director, musical director, or producer if known
- The "makingOf" should include: band members/performers at this specific show, backing musicians, special guests, opening acts, venue information (capacity, location), tour context (which tour, what leg), production details, stage design, was this officially recorded/released?
- The "plot" should describe THIS SPECIFIC SHOW in detail:
  * Setlist highlights (famous songs played, rare tracks, first/last time a song was performed)
  * Memorable moments and standout performances
  * Audience interaction and atmosphere
  * Special guests who appeared on stage
  * Encores and finale
  * Any technical issues, incidents, or notable events
  * Historical significance of the show (was this a legendary performance? Why?)
  * Critical reception if known
- Example: For "Pink-Floyd-Live-Earls-Court-1994", provide details about the Division Bell Tour, specific concert date, setlist, and performance highlights
- Example: For "nirvana-reading-1992", provide the exact date (August 30, 1992), details about the legendary wheelchair entrance, setlist including "Smells Like Teen Spirit", and why this show is considered iconic

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
    
    // Also detect month-year patterns like "february-1997", "jan-2005", etc.
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                        'july', 'august', 'september', 'october', 'november', 'december',
                        'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
    const monthYearPattern = new RegExp(`(${monthNames.join('|')})[-_. ]?(\\d{4})`, 'i');
    const monthYearMatch = filename.match(monthYearPattern);
    let detectedMonthYear: { month: string; year: string } | null = null;
    if (monthYearMatch) {
      detectedMonthYear = { month: monthYearMatch[1], year: monthYearMatch[2] };
    }
    
    // Extract potential team names from filename
    // Common NBA teams
    const nbaTeams = ['bulls', 'lakers', 'celtics', 'knicks', 'heat', 'warriors', 'nets', 'clippers',
                      'rockets', 'spurs', 'mavericks', 'mavs', 'suns', 'nuggets', 'sixers', '76ers',
                      'bucks', 'raptors', 'pistons', 'pacers', 'hawks', 'hornets', 'magic', 'wizards',
                      'cavaliers', 'cavs', 'thunder', 'blazers', 'trailblazers', 'jazz', 'grizzlies',
                      'pelicans', 'timberwolves', 'wolves', 'kings', 'chicago', 'los angeles', 'boston',
                      'new york', 'miami', 'golden state', 'brooklyn', 'houston', 'san antonio', 'dallas',
                      'phoenix', 'denver', 'philadelphia', 'milwaukee', 'toronto', 'detroit', 'indiana',
                      'atlanta', 'charlotte', 'orlando', 'washington', 'cleveland', 'oklahoma city', 
                      'portland', 'utah', 'memphis', 'new orleans', 'minnesota', 'sacramento'];
    // Common NFL teams
    const nflTeams = ['patriots', 'cowboys', 'packers', 'steelers', '49ers', 'niners', 'bears', 'giants',
                      'eagles', 'broncos', 'raiders', 'chiefs', 'seahawks', 'dolphins', 'jets', 'ravens',
                      'colts', 'saints', 'bills', 'rams', 'chargers', 'vikings', 'cardinals', 'falcons',
                      'panthers', 'buccaneers', 'bucs', 'bengals', 'browns', 'texans', 'titans', 'jaguars',
                      'lions', 'commanders', 'redskins'];
    // Common MLB teams  
    const mlbTeams = ['yankees', 'red sox', 'redsox', 'dodgers', 'cubs', 'mets', 'braves', 'cardinals',
                      'astros', 'phillies', 'padres', 'giants', 'mariners', 'twins', 'guardians', 'indians',
                      'orioles', 'rays', 'blue jays', 'royals', 'white sox', 'whitesox', 'tigers', 'rangers',
                      'athletics', 'angels', 'rockies', 'brewers', 'reds', 'pirates', 'marlins', 'nationals',
                      'diamondbacks', 'dbacks'];
    // Common NHL teams
    const nhlTeams = ['bruins', 'canadiens', 'habs', 'maple leafs', 'leafs', 'blackhawks', 'red wings',
                      'penguins', 'rangers', 'flyers', 'oilers', 'flames', 'canucks', 'avalanche', 'lightning',
                      'blues', 'capitals', 'caps', 'sharks', 'ducks', 'kings', 'devils', 'islanders', 'hurricanes',
                      'panthers', 'predators', 'preds', 'wild', 'jets', 'senators', 'sens', 'sabres', 'coyotes',
                      'golden knights', 'kraken', 'blue jackets'];
    
    const allTeams = [...nbaTeams, ...nflTeams, ...mlbTeams, ...nhlTeams];
    const detectedTeams: string[] = [];
    for (const team of allTeams) {
      if (lowerFilename.includes(team.replace(/ /g, '')) || 
          lowerFilename.includes(team.replace(/ /g, '-')) ||
          lowerFilename.includes(team.replace(/ /g, '_'))) {
        // Capitalize for readability
        const capitalizedTeam = team.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (!detectedTeams.includes(capitalizedTeam)) {
          detectedTeams.push(capitalizedTeam);
        }
      }
    }
    
    // Detect sports-related keywords
    const sportsKeywords = ['vs', 'game', 'championship', 'finals', 'playoff', 'playoffs', 'bowl', 'cup', 
                           'match', 'race', 'fight', 'boxing', 'ufc', 'nba', 'nfl', 'mlb', 
                           'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey',
                           'espn', 'tnt', 'tbs', 'abc', 'cbs', 'nbc', 'fox', 'sports'];
    const hasSportsKeywords = sportsKeywords.some(keyword => lowerFilename.includes(keyword));
    
    // =====================
    // CONCERT/MUSIC DETECTION
    // =====================
    
    // Popular bands and artists for detection
    const artists = [
      // Classic Rock
      'pink floyd', 'led zeppelin', 'the beatles', 'beatles', 'rolling stones', 'the who', 'queen',
      'ac dc', 'acdc', 'aerosmith', 'black sabbath', 'deep purple', 'jimi hendrix', 'hendrix',
      'the doors', 'doors', 'eric clapton', 'clapton', 'cream', 'grateful dead', 'dead',
      'eagles', 'fleetwood mac', 'genesis', 'yes', 'rush', 'kansas', 'boston', 'journey',
      'van halen', 'def leppard', 'bon jovi', 'guns n roses', 'gnr', 'motley crue',
      // Metal
      'metallica', 'iron maiden', 'judas priest', 'slayer', 'megadeth', 'anthrax', 'pantera',
      'ozzy osbourne', 'ozzy', 'dio', 'motorhead', 'tool', 'slipknot', 'korn', 'system of a down',
      'rammstein', 'nightwish', 'dream theater', 'opeth', 'mastodon', 'lamb of god', 'gojira',
      // Alternative/Grunge
      'nirvana', 'pearl jam', 'soundgarden', 'alice in chains', 'stone temple pilots', 'stp',
      'smashing pumpkins', 'radiohead', 'u2', 'r.e.m.', 'rem', 'the cure', 'cure', 'depeche mode',
      'nine inch nails', 'nin', 'rage against the machine', 'ratm', 'foo fighters', 'green day',
      'blink 182', 'blink-182', 'red hot chili peppers', 'rhcp', 'weezer', 'oasis', 'blur',
      // Pop/R&B
      'michael jackson', 'prince', 'madonna', 'whitney houston', 'mariah carey', 'janet jackson',
      'beyonce', 'beyoncé', 'taylor swift', 'lady gaga', 'bruno mars', 'adele', 'ed sheeran',
      'katy perry', 'rihanna', 'justin timberlake', 'britney spears', 'christina aguilera',
      'backstreet boys', 'nsync', '*nsync', 'one direction', 'bts', 'blackpink',
      // Hip-Hop/Rap
      'jay-z', 'jay z', 'kanye west', 'kanye', 'eminem', 'dr. dre', 'dr dre', 'snoop dogg',
      'tupac', '2pac', 'biggie', 'notorious b.i.g.', 'nas', 'kendrick lamar', 'drake',
      'travis scott', 'j. cole', 'j cole', 'lil wayne', 'outkast', 'a tribe called quest',
      'wu-tang clan', 'wu tang', 'public enemy', 'run dmc', 'run-dmc', 'beastie boys',
      // Electronic/DJ
      'daft punk', 'deadmau5', 'skrillex', 'avicii', 'calvin harris', 'david guetta', 'tiesto',
      'armin van buuren', 'above & beyond', 'bassnectar', 'pretty lights', 'odesza',
      'the chemical brothers', 'chemical brothers', 'fatboy slim', 'prodigy', 'the prodigy',
      'kraftwerk', 'aphex twin', 'boards of canada', 'massive attack', 'portishead',
      // Country
      'johnny cash', 'willie nelson', 'dolly parton', 'garth brooks', 'shania twain',
      'tim mcgraw', 'faith hill', 'carrie underwood', 'keith urban', 'blake shelton',
      'luke bryan', 'chris stapleton', 'jason aldean', 'kenny chesney', 'george strait',
      // Jazz/Blues
      'miles davis', 'john coltrane', 'coltrane', 'duke ellington', 'louis armstrong',
      'charlie parker', 'thelonious monk', 'dizzy gillespie', 'herbie hancock', 'chick corea',
      'bb king', 'b.b. king', 'muddy waters', 'howlin wolf', 'robert johnson', 'stevie ray vaughan',
      // Modern Rock/Indie
      'arctic monkeys', 'the strokes', 'strokes', 'the killers', 'killers', 'muse', 'coldplay',
      'imagine dragons', 'twenty one pilots', 'the black keys', 'black keys', 'tame impala',
      'vampire weekend', 'arcade fire', 'the national', 'lcd soundsystem', 'mgmt', 'phoenix',
      // Punk
      'the ramones', 'ramones', 'sex pistols', 'the clash', 'clash', 'bad religion', 'nofx',
      'rancid', 'social distortion', 'dead kennedys', 'misfits', 'black flag', 'minor threat',
      // Misc Legends
      'david bowie', 'bowie', 'elton john', 'billy joel', 'bruce springsteen', 'springsteen',
      'stevie wonder', 'bob dylan', 'dylan', 'neil young', 'joni mitchell', 'paul simon',
      'tom petty', 'bob marley', 'marley', 'peter gabriel', 'phil collins', 'sting', 'the police',
      'dire straits', 'mark knopfler', 'santana', 'zz top', 'lynyrd skynyrd', 'allman brothers'
    ];
    
    // Detect artists in filename
    const detectedArtists: string[] = [];
    for (const artist of artists) {
      const artistPattern = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[-_. ]?');
      const regex = new RegExp(artistPattern, 'i');
      if (regex.test(lowerFilename)) {
        // Capitalize for readability
        const capitalizedArtist = artist.split(' ').map(w => 
          w.charAt(0).toUpperCase() + w.slice(1)
        ).join(' ');
        if (!detectedArtists.some(a => a.toLowerCase() === capitalizedArtist.toLowerCase())) {
          detectedArtists.push(capitalizedArtist);
        }
      }
    }
    
    // Popular venues for detection
    const venues = [
      'madison square garden', 'msg', 'wembley', 'wembley stadium', 'earls court', "earl's court",
      'red rocks', 'hollywood bowl', 'radio city', 'carnegie hall', 'royal albert hall',
      'the forum', 'la forum', 'fillmore', 'fillmore west', 'fillmore east', 'apollo',
      'hammersmith odeon', 'hammersmith', 'budokan', 'tokyo dome', 'sydney opera house',
      'glastonbury', 'coachella', 'lollapalooza', 'bonnaroo', 'woodstock', 'monterey',
      'isle of wight', 'reading', 'leeds', 'download', 'rock am ring', 'rock in rio',
      'knebworth', 'live aid', 'live 8', 'us festival', 'ozzfest', 'warped tour',
      'austin city limits', 'acl', 'outside lands', 'primavera', 'tomorrowland', 'ultra',
      'burning man', 'sxsw', 'montreux', 'north sea jazz', 'new orleans jazz', 'newport'
    ];
    
    // Detect venues in filename
    const detectedVenues: string[] = [];
    for (const venue of venues) {
      const venuePattern = venue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[-_. ]?');
      const regex = new RegExp(venuePattern, 'i');
      if (regex.test(lowerFilename)) {
        const capitalizedVenue = venue.split(' ').map(w => 
          w.charAt(0).toUpperCase() + w.slice(1)
        ).join(' ');
        if (!detectedVenues.some(v => v.toLowerCase() === capitalizedVenue.toLowerCase())) {
          detectedVenues.push(capitalizedVenue);
        }
      }
    }
    
    // Concert-related keywords
    const concertKeywords = ['live', 'concert', 'tour', 'performance', 'show', 'gig', 
                            'unplugged', 'acoustic', 'mtv', 'vhs', 'dvd', 'bootleg',
                            'festival', 'fest', 'reunion', 'farewell', 'anniversary'];
    const hasConcertKeywords = concertKeywords.some(keyword => lowerFilename.includes(keyword));
    
    // Determine if this is concert content
    const isConcertContent = detectedArtists.length > 0 && 
                            (hasConcertKeywords || detectedVenues.length > 0 || detectedDate || detectedMonthYear);
    
    // Determine if this is sports content
    const isSportsContent = (detectedDate || detectedMonthYear) && (hasSportsKeywords || detectedTeams.length >= 2);
    const hasTeamMatchup = detectedTeams.length >= 2;
    
    // If we detect sports content, add a detailed hint to the prompt
    if (isSportsContent || hasTeamMatchup) {
      let sportsHint = `

IMPORTANT: This appears to be a SPORTS recording.`;
      
      // Add detected teams
      if (detectedTeams.length >= 2) {
        sportsHint += `
DETECTED TEAMS: ${detectedTeams.slice(0, 2).join(' vs ')}`;
      } else if (detectedTeams.length === 1) {
        sportsHint += `
DETECTED TEAM: ${detectedTeams[0]}`;
      }
      
      // Add date/time period info
      if (detectedDate) {
        sportsHint += `
DETECTED DATE: ${detectedDate}`;
      } else if (detectedMonthYear) {
        sportsHint += `
DETECTED TIME PERIOD: ${detectedMonthYear.month} ${detectedMonthYear.year}`;
      }
      
      // Guide the AI to research the exact date
      sportsHint += `

TO FIND THE EXACT GAME DATE, think about this search query:
"when did ${detectedTeams.length >= 2 ? detectedTeams.slice(0, 2).join(' and ') + ' play' : 'this game happen'} in ${detectedMonthYear ? detectedMonthYear.month + ' ' + detectedMonthYear.year : detectedDate || 'this time period'}?"

RESEARCH STRATEGY:
1. Identify the league/sport (NBA, NFL, MLB, NHL, etc.) from context clues like "nba-on-tbs"
2. Look up the teams' schedules for the specified month/year
3. Find the EXACT DATE of the game (there may have been multiple games between these teams that month)
4. Get details about that specific game

REQUIRED FIELDS:
- "title": Format as "Team A vs Team B" (e.g., "Bulls vs Lakers")
- "releaseDate": The EXACT date of the game in YYYY-MM-DD format (THIS IS CRITICAL - research to find it!)
- "year": The year extracted from the filename
- "category": The sport type (Basketball, Football, Baseball, Hockey, etc.)
- "type": Must be "sports"
- "plot": Comprehensive game details including:
  * EXACT FINAL SCORE
  * Standout player performances WITH STATS (points, rebounds, assists, yards, TDs, etc.)
  * Key plays and game-changing moments
  * How the game unfolded (quarter by quarter, period by period, etc.)
  * Context (playoff game, rivalry, streaks, etc.)
- "makingOf": Key players, coaches, venue, broadcast info, significance of the matchup`;

      userPrompt += sportsHint;
    } else if (isConcertContent) {
      // Concert content detection - add detailed hint
      let concertHint = `

IMPORTANT: This appears to be a CONCERT/LIVE PERFORMANCE recording.`;
      
      // Add detected artist(s)
      if (detectedArtists.length > 0) {
        concertHint += `
DETECTED ARTIST(S): ${detectedArtists.join(', ')}`;
      }
      
      // Add detected venue(s)
      if (detectedVenues.length > 0) {
        concertHint += `
DETECTED VENUE(S): ${detectedVenues.join(', ')}`;
      }
      
      // Add date/time period info
      if (detectedDate) {
        concertHint += `
DETECTED DATE: ${detectedDate}`;
      } else if (detectedMonthYear) {
        concertHint += `
DETECTED TIME PERIOD: ${detectedMonthYear.month} ${detectedMonthYear.year}`;
      }
      
      // Guide the AI to research the exact concert date
      const artistForQuery = detectedArtists.length > 0 ? detectedArtists[0] : 'the artist';
      const venueForQuery = detectedVenues.length > 0 ? detectedVenues[0] : null;
      const dateForQuery = detectedMonthYear 
        ? `${detectedMonthYear.month} ${detectedMonthYear.year}` 
        : detectedDate || 'the specified time period';
      
      concertHint += `

TO FIND THE EXACT CONCERT DATE, think about this search query:
"${artistForQuery} ${venueForQuery ? venueForQuery + ' concert' : 'live'} ${dateForQuery}"
or
"${artistForQuery} tour dates ${detectedMonthYear?.year || ''}"

RESEARCH STRATEGY:
1. Identify the artist/band and any tour name from the filename
2. Look up the artist's tour history for the specified year/time period
3. If a venue is mentioned, find when they played that specific venue
4. Find the EXACT DATE of the concert/performance
5. Get setlist and performance details if available

REQUIRED FIELDS:
- "title": Format as "Artist - Tour/Show Name" or "Artist - Live at Venue" (e.g., "Pink Floyd - The Division Bell Tour" or "Nirvana - Live at Reading")
- "releaseDate": The EXACT date of the concert in YYYY-MM-DD format (THIS IS CRITICAL - research to find it!)
- "year": The year of the performance
- "category": The music genre (Rock, Metal, Pop, Hip-Hop, Electronic, Jazz, etc.)
- "type": Must be "concert"
- "plot": Comprehensive concert details including:
  * Setlist highlights (notable songs performed, rare tracks, covers)
  * Memorable moments and performances
  * Audience interaction and atmosphere
  * Special guests who appeared
  * Encores and finale
  * Any technical or notable incidents
  * Historical significance of the show
- "makingOf": Performance and production details including:
  * Band members/lineup for this specific show
  * Supporting acts/opening bands
  * Tour context (tour name, leg of tour, tour dates)
  * Venue capacity and attendance
  * Stage production, visuals, and technical setup
  * Recording/filming details if known (was this an official release?)
  * Critical reception and reviews`;

      userPrompt += concertHint;
    } else if (hasSportsKeywords && detectedTeams.length > 0) {
      // Partial sports detection - still add some guidance
      userPrompt += `

Note: This may be sports content. Detected team(s): ${detectedTeams.join(', ')}
If this is a game recording, set type to "sports" and try to determine the exact game date for the releaseDate field.`;
    } else if (detectedArtists.length > 0) {
      // Partial concert detection - still add some guidance
      userPrompt += `

Note: This may be concert/live performance content. Detected artist(s): ${detectedArtists.join(', ')}
If this is a concert recording, set type to "concert" and try to determine the exact performance date for the releaseDate field.`;
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
