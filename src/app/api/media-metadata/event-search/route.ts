import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Normalize a team name for fuzzy matching:
 * - lowercase
 * - strip common prefixes like "LA", "New", "San", etc.
 * - collapse whitespace
 */
function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if two team name strings are a likely match.
 * Handles cases like "Chicago" matching "Chicago Bulls",
 * "Bulls" matching "Chicago Bulls", "LA Lakers" matching "Los Angeles Lakers", etc.
 */
function teamsMatch(needle: string, haystack: string): boolean {
  const n = normalizeTeam(needle);
  const h = normalizeTeam(haystack);
  if (!n || !h) return false;

  // Exact match
  if (n === h) return true;

  // One contains the other
  if (h.includes(n) || n.includes(h)) return true;

  // Word-level overlap: if any significant word matches
  const nWords = n.split(" ").filter((w) => w.length > 2);
  const hWords = h.split(" ").filter((w) => w.length > 2);
  for (const nw of nWords) {
    for (const hw of hWords) {
      if (nw === hw) return true;
    }
  }

  // Common aliases
  const aliases: Record<string, string[]> = {
    "lakers": ["la lakers", "los angeles lakers", "lal"],
    "clippers": ["la clippers", "los angeles clippers", "lac"],
    "warriors": ["golden state warriors", "golden state", "gsw"],
    "celtics": ["boston celtics", "boston", "bos"],
    "bulls": ["chicago bulls", "chicago", "chi"],
    "knicks": ["new york knicks", "new york", "nyk"],
    "nets": ["brooklyn nets", "new jersey nets", "brooklyn", "new jersey", "brk", "njn"],
    "heat": ["miami heat", "miami", "mia"],
    "sixers": ["philadelphia 76ers", "76ers", "philadelphia", "phi"],
    "76ers": ["philadelphia 76ers", "sixers", "philadelphia", "phi"],
    "spurs": ["san antonio spurs", "san antonio", "sas"],
    "mavericks": ["dallas mavericks", "dallas", "mavs", "dal"],
    "rockets": ["houston rockets", "houston", "hou"],
    "suns": ["phoenix suns", "phoenix", "pho"],
    "nuggets": ["denver nuggets", "denver", "den"],
    "pistons": ["detroit pistons", "detroit", "det"],
    "pacers": ["indiana pacers", "indiana", "ind"],
    "bucks": ["milwaukee bucks", "milwaukee", "mil"],
    "timberwolves": ["minnesota timberwolves", "minnesota", "wolves", "min"],
    "raptors": ["toronto raptors", "toronto", "tor"],
    "hawks": ["atlanta hawks", "atlanta", "atl"],
    "hornets": ["charlotte hornets", "charlotte", "cha", "chh"],
    "magic": ["orlando magic", "orlando", "orl"],
    "wizards": ["washington wizards", "washington bullets", "washington", "bullets", "was", "wsb"],
    "cavaliers": ["cleveland cavaliers", "cleveland", "cavs", "cle"],
    "thunder": ["oklahoma city thunder", "okc", "seattle supersonics", "sonics", "seattle", "sea"],
    "supersonics": ["seattle supersonics", "sonics", "seattle", "sea", "oklahoma city thunder", "okc"],
    "blazers": ["portland trail blazers", "portland", "trail blazers", "por"],
    "jazz": ["utah jazz", "utah", "uta"],
    "grizzlies": ["memphis grizzlies", "memphis", "vancouver grizzlies", "vancouver", "mem", "van"],
    "pelicans": ["new orleans pelicans", "new orleans", "new orleans hornets", "nop", "noh"],
    "kings": ["sacramento kings", "sacramento", "sac"],
    "bobcats": ["charlotte bobcats", "charlotte", "cha"],
  };

  for (const [key, alts] of Object.entries(aliases)) {
    const allNames = [key, ...alts];
    const nMatches = allNames.some((a) => n.includes(a) || a.includes(n));
    const hMatches = allNames.some((a) => h.includes(a) || a.includes(h));
    if (nMatches && hMatches) return true;
  }

  return false;
}

type GameResult = {
  team1: string;
  team2: string;
  score1: number | null;
  score2: number | null;
  boxScoreUrl: string;
};

/**
 * Scrape Basketball Reference date page for all games on a given date.
 * Returns a list of games with their box score URLs.
 */
async function searchBasketballReference(
  date: string // YYYY-MM-DD
): Promise<GameResult[]> {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return [];

  const url = `https://www.basketball-reference.com/boxscores/index.cgi?month=${month}&day=${day}&year=${year}`;
  console.log(`[Event Search] Fetching Basketball Reference: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[Event Search] Basketball Reference returned ${response.status}`);
      return [];
    }

    const html = await response.text();
    const games: GameResult[] = [];

    // Extract box score links and surrounding team info.
    // Box score links look like: /boxscores/199702020SEA.html
    const boxScorePattern = /\/boxscores\/(\d{9}[A-Z]{3})\.html/g;
    const boxScoreIds = new Set<string>();
    let match;
    while ((match = boxScorePattern.exec(html)) !== null) {
      boxScoreIds.add(match[1]);
    }

    // For each unique box score ID, extract team names from the HTML context.
    // The page has team links like /teams/CHI/1997.html near each box score.
    for (const bsId of boxScoreIds) {
      const boxScoreUrl = `https://www.basketball-reference.com/boxscores/${bsId}.html`;

      // Find the game section containing this box score.
      // Teams appear as links like /teams/XXX/YYYY.html near the box score link.
      const sectionPattern = new RegExp(
        // Look for two team links before this box score
        `/teams/([A-Z]{3})/\\d{4}\\.html[\\s\\S]{0,2000}?/teams/([A-Z]{3})/\\d{4}\\.html[\\s\\S]{0,500}?${bsId}\\.html`,
      );
      const sectionMatch = html.match(sectionPattern);

      if (sectionMatch) {
        const awayAbbr = sectionMatch[1];
        const homeAbbr = sectionMatch[2];

        // Also try to extract full team names from the HTML
        // Team names appear in links like: >Chicago</a> or >Chicago Bulls</a>
        const awayNameMatch = html.match(
          new RegExp(`/teams/${awayAbbr}/\\d{4}\\.html[^>]*>([^<]+)<`)
        );
        const homeNameMatch = html.match(
          new RegExp(`/teams/${homeAbbr}/\\d{4}\\.html[^>]*>([^<]+)<`)
        );

        const awayName = awayNameMatch ? awayNameMatch[1].trim() : awayAbbr;
        const homeName = homeNameMatch ? homeNameMatch[1].trim() : homeAbbr;

        // Try to extract scores: look for the pattern near the box score link
        // Score is typically like: >102< or >92<
        const scorePattern = new RegExp(
          `/teams/${awayAbbr}/\\d{4}\\.html[\\s\\S]{0,200}?<td[^>]*>(\\d+)</td>[\\s\\S]{0,500}?/teams/${homeAbbr}/\\d{4}\\.html[\\s\\S]{0,200}?<td[^>]*>(\\d+)</td>`
        );
        const scoreMatch = html.match(scorePattern);

        games.push({
          team1: awayName,
          team2: homeName,
          score1: scoreMatch ? parseInt(scoreMatch[1]) : null,
          score2: scoreMatch ? parseInt(scoreMatch[2]) : null,
          boxScoreUrl,
        });
      } else {
        // Fallback: extract the home team from the box score ID (last 3 chars)
        const homeAbbr = bsId.slice(-3);
        games.push({
          team1: "Unknown",
          team2: homeAbbr,
          score1: null,
          score2: null,
          boxScoreUrl,
        });
      }
    }

    console.log(`[Event Search] Found ${games.length} games on ${date}`);
    return games;
  } catch (error) {
    console.warn("[Event Search] Error fetching Basketball Reference:", error);
    return [];
  }
}

/**
 * Scrape Pro Football Reference date page for games.
 */
async function searchProFootballReference(
  date: string
): Promise<GameResult[]> {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return [];

  const url = `https://www.pro-football-reference.com/boxscores/index.cgi?month=${month}&day=${day}&year=${year}`;
  console.log(`[Event Search] Fetching Pro Football Reference: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return [];
    const html = await response.text();
    const games: GameResult[] = [];

    // PFR box score links look like /boxscores/199801110.htm
    const boxScorePattern = /\/boxscores\/(\d{9}\w*)\.htm/g;
    const boxScoreIds = new Set<string>();
    let match;
    while ((match = boxScorePattern.exec(html)) !== null) {
      boxScoreIds.add(match[1]);
    }

    for (const bsId of boxScoreIds) {
      games.push({
        team1: "Unknown",
        team2: "Unknown",
        score1: null,
        score2: null,
        boxScoreUrl: `https://www.pro-football-reference.com/boxscores/${bsId}.htm`,
      });
    }

    console.log(`[Event Search] Found ${games.length} NFL games on ${date}`);
    return games;
  } catch (error) {
    console.warn("[Event Search] Error fetching PFR:", error);
    return [];
  }
}

/**
 * POST /api/media-metadata/event-search
 *
 * Searches sports reference sites to find the actual box score URL for a game.
 *
 * Body:
 *   - sport: string (e.g., "Basketball", "Football", "Baseball", "Hockey")
 *   - date: string (YYYY-MM-DD format)
 *   - team1?: string (first team name or city)
 *   - team2?: string (second team name or city)
 *
 * Returns:
 *   - games: array of { team1, team2, score1, score2, boxScoreUrl }
 *   - bestMatch: the best matching game (if team1/team2 provided) or null
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sport, date, team1, team2 } = body;

    if (!date || typeof date !== "string") {
      return NextResponse.json(
        { error: "date is required (YYYY-MM-DD format)" },
        { status: 400 }
      );
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "date must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    const sportLower = (sport || "basketball").toLowerCase();
    console.log(
      `[Event Search] Searching for ${sportLower} game on ${date}` +
        (team1 ? ` — team1: "${team1}"` : "") +
        (team2 ? ` — team2: "${team2}"` : "")
    );

    let games: GameResult[] = [];

    if (
      sportLower.includes("basketball") ||
      sportLower.includes("nba")
    ) {
      games = await searchBasketballReference(date);
    } else if (
      sportLower.includes("football") ||
      sportLower.includes("nfl")
    ) {
      games = await searchProFootballReference(date);
    } else {
      // For unsupported sports, return empty — the AI-generated URL (if any) will be kept
      console.log(`[Event Search] Sport "${sportLower}" not yet supported for automated search`);
      return NextResponse.json({ games: [], bestMatch: null });
    }

    // Find the best match based on team names
    let bestMatch: GameResult | null = null;

    if (games.length > 0 && (team1 || team2)) {
      for (const game of games) {
        const gameTeams = `${game.team1} ${game.team2}`;
        const t1Matches = team1 ? teamsMatch(team1, gameTeams) : true;
        const t2Matches = team2 ? teamsMatch(team2, gameTeams) : true;

        if (t1Matches && t2Matches) {
          bestMatch = game;
          console.log(
            `[Event Search] Best match: ${game.team1} vs ${game.team2} → ${game.boxScoreUrl}`
          );
          break;
        }
      }

      // If no match with both teams, try matching just one
      if (!bestMatch) {
        for (const game of games) {
          const gameTeams = `${game.team1} ${game.team2}`;
          if (
            (team1 && teamsMatch(team1, gameTeams)) ||
            (team2 && teamsMatch(team2, gameTeams))
          ) {
            bestMatch = game;
            console.log(
              `[Event Search] Partial match: ${game.team1} vs ${game.team2} → ${game.boxScoreUrl}`
            );
            break;
          }
        }
      }
    } else if (games.length === 1) {
      // If only one game on that date, it's probably the right one
      bestMatch = games[0];
    }

    return NextResponse.json({ games, bestMatch });
  } catch (error) {
    console.error("[Event Search] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
