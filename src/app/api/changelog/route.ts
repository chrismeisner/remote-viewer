import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getEffectiveMediaRoot, getDataFolderForMediaRoot } from "@/lib/config";
import { isFtpConfigured, uploadJsonToFtp } from "@/lib/ftp";
import type { MediaSource } from "@/constants/media";

export const runtime = "nodejs";

// Changelog types
export type ChangelogCategory = "addition" | "update" | "removal" | "note";

export type ChangelogEntry = {
  id: string;
  date: string; // ISO date string
  message: string;
  category: ChangelogCategory;
};

export type Changelog = {
  entries: ChangelogEntry[];
};

/**
 * Get the changelog file path based on current config.
 * Uses: <mediaRoot>/.remote-viewer/changelog.json if configured
 * Falls back to data/local/changelog.json when no media root is configured.
 */
async function getChangelogFilePath(): Promise<string | null> {
  const mediaRoot = await getEffectiveMediaRoot();
  
  if (mediaRoot) {
    const dataRoot = getDataFolderForMediaRoot(mediaRoot);
    try {
      await fs.mkdir(dataRoot, { recursive: true });
      return path.join(dataRoot, "changelog.json");
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback to data/local
  const fallbackRoot = path.join(process.cwd(), "data", "local");
  try {
    await fs.mkdir(fallbackRoot, { recursive: true });
    return path.join(fallbackRoot, "changelog.json");
  } catch {
    return null;
  }
}

/**
 * Load changelog from local filesystem.
 */
async function loadLocalChangelog(): Promise<Changelog> {
  const changelogFile = await getChangelogFilePath();
  
  if (!changelogFile) {
    return { entries: [] };
  }
  
  try {
    const raw = await fs.readFile(changelogFile, "utf8");
    const parsed = JSON.parse(raw) as Changelog;
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return { entries: [] };
    }
    throw error;
  }
}

/**
 * Load changelog from remote.
 */
async function loadRemoteChangelog(): Promise<Changelog> {
  const base = process.env.REMOTE_MEDIA_BASE;
  if (!base) return { entries: [] };

  try {
    const url = new URL("changelog.json", base).toString();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) return { entries: [] };
      console.warn("Remote changelog fetch failed", res.status);
      return { entries: [] };
    }
    const parsed = (await res.json()) as Changelog;
    return parsed;
  } catch (error) {
    console.warn("Failed to fetch remote changelog", error);
    return { entries: [] };
  }
}

/**
 * Save changelog to local filesystem.
 */
async function saveLocalChangelog(changelog: Changelog): Promise<void> {
  const changelogFile = await getChangelogFilePath();
  
  if (!changelogFile) {
    throw new Error("Unable to save changelog: data folder is not accessible.");
  }
  
  await fs.mkdir(path.dirname(changelogFile), { recursive: true });
  await fs.writeFile(changelogFile, JSON.stringify(changelog, null, 2), {
    encoding: "utf8",
  });
}

/**
 * Generate a unique ID for a changelog entry.
 */
function generateEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// GET - Read changelog
export async function GET(request: NextRequest) {
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source: MediaSource =
    sourceParam === "remote" || sourceParam === "local" ? sourceParam : "local";

  try {
    const changelog = source === "remote" 
      ? await loadRemoteChangelog()
      : await loadLocalChangelog();
    
    // Sort entries by date descending (most recent first)
    changelog.entries.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    return NextResponse.json({ changelog, source });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load changelog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST - Add new entry
export async function POST(request: NextRequest) {
  const sourceParam = request.nextUrl.searchParams.get("source");
  
  try {
    const body = await request.json();
    const { message, category, date } = body as {
      message?: string;
      category?: ChangelogCategory;
      date?: string;
    };

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const validCategories: ChangelogCategory[] = ["addition", "update", "removal", "note"];
    const entryCategory: ChangelogCategory = 
      category && validCategories.includes(category) ? category : "note";

    const newEntry: ChangelogEntry = {
      id: generateEntryId(),
      date: date || new Date().toISOString(),
      message: message.trim(),
      category: entryCategory,
    };

    // For remote source, save directly to FTP
    if (sourceParam === "remote") {
      if (!isFtpConfigured()) {
        return NextResponse.json(
          { error: "FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH." },
          { status: 400 }
        );
      }

      const changelog = await loadRemoteChangelog();
      changelog.entries.push(newEntry);
      
      // Sort by date descending
      changelog.entries.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      await uploadJsonToFtp("changelog.json", changelog);
      return NextResponse.json({ entry: newEntry, source: "remote" });
    }

    // Local source
    const changelog = await loadLocalChangelog();
    changelog.entries.push(newEntry);
    
    // Sort by date descending
    changelog.entries.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    await saveLocalChangelog(changelog);
    return NextResponse.json({ entry: newEntry, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add changelog entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE - Remove entry by ID
export async function DELETE(request: NextRequest) {
  const sourceParam = request.nextUrl.searchParams.get("source");
  const entryId = request.nextUrl.searchParams.get("id");

  if (!entryId) {
    return NextResponse.json({ error: "Entry ID is required" }, { status: 400 });
  }

  try {
    // For remote source, save directly to FTP
    if (sourceParam === "remote") {
      if (!isFtpConfigured()) {
        return NextResponse.json(
          { error: "FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH." },
          { status: 400 }
        );
      }

      const changelog = await loadRemoteChangelog();
      const initialLength = changelog.entries.length;
      changelog.entries = changelog.entries.filter((e) => e.id !== entryId);

      if (changelog.entries.length === initialLength) {
        return NextResponse.json({ error: "Entry not found" }, { status: 404 });
      }

      await uploadJsonToFtp("changelog.json", changelog);
      return NextResponse.json({ success: true, source: "remote" });
    }

    // Local source
    const changelog = await loadLocalChangelog();
    const initialLength = changelog.entries.length;
    changelog.entries = changelog.entries.filter((e) => e.id !== entryId);

    if (changelog.entries.length === initialLength) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    await saveLocalChangelog(changelog);
    return NextResponse.json({ success: true, source: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete changelog entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
