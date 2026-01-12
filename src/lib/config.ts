import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_FILE = path.join(process.cwd(), "data", "local", "config.json");
const DATA_SUBFOLDER = ".remote-viewer";

export type AppConfig = {
  mediaRoot: string | null; // Always required for local mode - no default
};

let configCache: { config: AppConfig; mtimeMs: number | null } | null = null;

/**
 * Determine if we're running in local mode (can access local filesystem).
 * Returns false when deployed to Vercel or similar serverless platforms.
 */
export function isLocalMode(): boolean {
  // Vercel sets this env var
  if (process.env.VERCEL) return false;
  // Explicit override
  if (process.env.LOCAL_MODE === "false") return false;
  if (process.env.LOCAL_MODE === "true") return true;
  // Default: assume local if not on Vercel
  return true;
}

/**
 * Load the config from disk.
 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const stat = await fs.stat(CONFIG_FILE);
    if (configCache && configCache.mtimeMs === stat.mtimeMs) {
      return configCache.config;
    }

    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as AppConfig;
    const config: AppConfig = {
      mediaRoot: typeof parsed.mediaRoot === "string" ? parsed.mediaRoot : null,
    };
    configCache = { config, mtimeMs: stat.mtimeMs };
    return config;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return { mediaRoot: null };
    }
    throw error;
  }
}

/**
 * Save the config to disk.
 */
export async function saveConfig(config: AppConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  configCache = { config, mtimeMs: null }; // Invalidate mtime check
}

/**
 * Get the effective media root path.
 * Returns null if no folder is configured - local mode REQUIRES a configured folder.
 * Priority: config.mediaRoot > env MEDIA_ROOT > null
 */
export async function getEffectiveMediaRoot(): Promise<string | null> {
  const config = await loadConfig();
  if (config.mediaRoot) {
    return config.mediaRoot;
  }
  if (process.env.MEDIA_ROOT) {
    return path.resolve(process.env.MEDIA_ROOT);
  }
  // No default - local mode requires explicit folder configuration
  return null;
}

/**
 * Check if a media root is configured for local mode.
 */
export async function hasMediaRootConfigured(): Promise<boolean> {
  const root = await getEffectiveMediaRoot();
  return root !== null;
}

/**
 * Get the data folder path for a given media root.
 * For portable mode: <mediaRoot>/.remote-viewer/
 */
export function getDataFolderForMediaRoot(mediaRoot: string): string {
  return path.join(mediaRoot, DATA_SUBFOLDER);
}

/**
 * Validate that a path is a valid, accessible directory.
 * Returns { valid: true } or { valid: false, error: string }
 */
export async function validateMediaPath(
  targetPath: string
): Promise<{ valid: true } | { valid: false; error: string }> {
  try {
    const resolved = path.resolve(targetPath);
    const stat = await fs.stat(resolved);
    
    if (!stat.isDirectory()) {
      return { valid: false, error: "Path is not a directory" };
    }

    // Try to read the directory to verify access
    await fs.readdir(resolved);

    // Check if we can write to the .remote-viewer subfolder
    const dataFolder = getDataFolderForMediaRoot(resolved);
    try {
      await fs.mkdir(dataFolder, { recursive: true });
      // Write a test file to verify write access
      const testFile = path.join(dataFolder, ".write-test");
      await fs.writeFile(testFile, "test", "utf8");
      await fs.unlink(testFile);
    } catch {
      return {
        valid: false,
        error: `Cannot write to ${dataFolder}. Check folder permissions.`,
      };
    }

    return { valid: true };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return { valid: false, error: "Path does not exist" };
    }
    if (err?.code === "EACCES") {
      return { valid: false, error: "Permission denied" };
    }
    return {
      valid: false,
      error: err?.message || "Unknown error accessing path",
    };
  }
}

/**
 * Clear any in-memory caches when media root changes.
 * This should be called after changing the media root.
 */
export function clearConfigCache(): void {
  configCache = null;
}
