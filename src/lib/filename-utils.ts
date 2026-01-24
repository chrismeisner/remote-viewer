/**
 * Client-safe filename utilities.
 * This file can be imported in both client and server components.
 */

/**
 * Clean up a filename for better URL compatibility and readability.
 * 
 * Examples:
 * - "My Movie (2020) [1080p].mp4" -> "my-movie-2020-1080p.mp4"
 * - "Dogma.1999.1080p.BrRip.x264.YIFY.mp4" -> "dogma-1999-1080p-brrip-x264-yify.mp4"
 * 
 * Rules:
 * - Converts to lowercase
 * - Replaces spaces, underscores, and periods with dashes
 * - Removes special characters like (), [], {}, etc.
 * - Normalizes multiple dashes to single dash
 * - Removes leading/trailing dashes from filename
 * - Preserves the file extension
 * - Preserves directory structure (only cleans the filename part)
 */
export function cleanupFilename(filePath: string): string {
  // Split path and filename
  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;

  // Split filename and extension
  const lastDot = filename.lastIndexOf(".");
  const name = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot > 0 ? filename.slice(lastDot).toLowerCase() : "";

  let cleaned = name
    // Convert to lowercase
    .toLowerCase()
    // Replace common separators (spaces, underscores, periods) with dashes
    .replace(/[\s_.]+/g, "-")
    // Remove parentheses, brackets, braces but keep content
    .replace(/[()[\]{}]/g, "")
    // Remove other special characters (keep alphanumeric and dashes)
    .replace(/[^a-z0-9-]/g, "")
    // Replace multiple dashes with single dash
    .replace(/-+/g, "-")
    // Remove leading/trailing dashes
    .replace(/^-+|-+$/g, "");

  // Ensure we have something left
  if (!cleaned) {
    cleaned = "unnamed";
  }

  return dir + cleaned + ext;
}

/**
 * Check if a filename would benefit from cleanup.
 * Returns true if the cleaned version differs from the original.
 */
export function needsFilenameCleanup(filePath: string): boolean {
  return filePath !== cleanupFilename(filePath);
}
