import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { isLocalMode } from "@/lib/config";

export const runtime = "nodejs";

type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  hasMediaFiles?: boolean;
};

type BrowseResponse = {
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
  roots?: { name: string; path: string }[];
};

const MEDIA_EXTENSIONS = [".mp4", ".mkv", ".mov", ".avi", ".m4v", ".webm"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

function isMediaFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return MEDIA_EXTENSIONS.includes(ext);
}

function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Get common root paths for the current OS
 */
function getRoots(): { name: string; path: string }[] {
  const platform = os.platform();
  
  if (platform === "darwin") {
    // macOS: show Volumes (external drives) and home directory
    return [
      { name: "Volumes", path: "/Volumes" },
      { name: "Home", path: os.homedir() },
      { name: "Root", path: "/" },
    ];
  } else if (platform === "win32") {
    // Windows: common drive letters
    return [
      { name: "C:", path: "C:\\" },
      { name: "D:", path: "D:\\" },
      { name: "Home", path: os.homedir() },
    ];
  } else {
    // Linux and others
    return [
      { name: "Home", path: os.homedir() },
      { name: "Root", path: "/" },
      { name: "Media", path: "/media" },
      { name: "Mnt", path: "/mnt" },
    ];
  }
}

/**
 * GET /api/browse?path=/some/path&type=images
 * Lists directories at the given path. Only available in local mode.
 * 
 * Query params:
 *   - path: directory path to browse
 *   - type: "images" to also include image files in the listing
 */
export async function GET(request: NextRequest) {
  // Only allow in local mode
  if (!isLocalMode()) {
    return NextResponse.json(
      { error: "Folder browsing is only available in local mode" },
      { status: 403 }
    );
  }

  const targetPath = request.nextUrl.searchParams.get("path");
  const browseType = request.nextUrl.searchParams.get("type"); // "images" to include image files
  const includeImages = browseType === "images";
  
  // If no path provided, return roots
  if (!targetPath) {
    const roots = getRoots();
    return NextResponse.json({
      currentPath: "",
      parentPath: null,
      entries: [],
      roots,
    } satisfies BrowseResponse);
  }

  try {
    const resolvedPath = path.resolve(targetPath);
    
    // Security: prevent path traversal attacks
    // Ensure the resolved path doesn't go somewhere unexpected
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: "Path is not a directory" },
        { status: 400 }
      );
    }

    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    
    // Filter and map to our format
    const directories: DirectoryEntry[] = [];
    const imageFiles: DirectoryEntry[] = [];
    let hasMediaInCurrentDir = false;
    
    for (const entry of entries) {
      // Skip hidden files/folders (starting with .)
      if (entry.name.startsWith(".")) continue;
      
      const entryPath = path.join(resolvedPath, entry.name);
      
      if (entry.isDirectory()) {
        // Check if this directory contains media files (shallow check)
        let hasMedia = false;
        try {
          const subEntries = await fs.readdir(entryPath, { withFileTypes: true });
          hasMedia = subEntries.some(
            (e) => e.isFile() && isMediaFile(e.name)
          );
        } catch {
          // Can't read directory, skip the media check
        }
        
        directories.push({
          name: entry.name,
          path: entryPath,
          isDirectory: true,
          hasMediaFiles: hasMedia,
        });
      } else if (entry.isFile()) {
        if (isMediaFile(entry.name)) {
          hasMediaInCurrentDir = true;
        }
        // Include image files if requested
        if (includeImages && isImageFile(entry.name)) {
          imageFiles.push({
            name: entry.name,
            path: entryPath,
            isDirectory: false,
          });
        }
      }
    }

    // Sort directories and files alphabetically
    directories.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    imageFiles.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

    // Combine: directories first, then image files
    const allEntries = [...directories, ...imageFiles];

    // Calculate parent path
    const parentPath = resolvedPath === "/" ? null : path.dirname(resolvedPath);

    return NextResponse.json({
      currentPath: resolvedPath,
      parentPath,
      entries: allEntries,
      roots: getRoots(),
    } satisfies BrowseResponse);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return NextResponse.json(
        { error: "Path does not exist" },
        { status: 404 }
      );
    }
    if (err?.code === "EACCES") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }
    const message = err?.message || "Failed to browse directory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
