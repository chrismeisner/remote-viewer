/**
 * Subtitle utilities: SRT-to-VTT conversion and validation.
 *
 * WebVTT (.vtt) is the only subtitle format natively supported by HTML5 <track>.
 * SRT (.srt) is the most common subtitle format in the wild.
 * The two formats are nearly identical — the conversion is a simple text transform.
 */

/**
 * Convert SRT subtitle content to WebVTT format.
 *
 * Differences handled:
 * - Adds the required "WEBVTT" header
 * - Replaces comma separators in timestamps with dots (00:01:15,000 → 00:01:15.000)
 * - Strips numeric cue sequence identifiers (the "1", "2", etc. lines)
 * - Normalizes line endings to \n
 */
export function srtToVtt(srt: string): string {
  // Normalize line endings
  const normalized = srt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  const lines = normalized.split("\n");
  const vttLines: string[] = ["WEBVTT", ""];

  let i = 0;
  while (i < lines.length) {
    // Skip blank lines
    if (lines[i].trim() === "") {
      i++;
      continue;
    }

    // Skip cue sequence number (a line that is just digits)
    if (/^\d+$/.test(lines[i].trim())) {
      i++;
      continue;
    }

    // Timestamp line: convert commas to dots
    if (lines[i].includes("-->")) {
      vttLines.push(lines[i].replace(/,/g, "."));
      i++;

      // Collect all text lines until blank line or end
      while (i < lines.length && lines[i].trim() !== "") {
        vttLines.push(lines[i]);
        i++;
      }

      // Add blank line separator between cues
      vttLines.push("");
      continue;
    }

    // Unexpected line — skip
    i++;
  }

  return vttLines.join("\n");
}

/**
 * Detect whether content is already in WebVTT format.
 */
export function isVtt(content: string): boolean {
  return content.trimStart().startsWith("WEBVTT");
}

/**
 * Validate that content looks like a valid subtitle file (SRT or VTT).
 * Returns the detected format or null if invalid.
 */
export function detectSubtitleFormat(content: string): "vtt" | "srt" | null {
  const trimmed = content.trim();

  if (trimmed.startsWith("WEBVTT")) {
    return "vtt";
  }

  // SRT files start with a cue number followed by a timestamp line
  if (/^\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(trimmed)) {
    return "srt";
  }

  // Looser SRT check: has at least one timestamp arrow
  if (/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(trimmed)) {
    return "srt";
  }

  return null;
}

/**
 * Ensure content is in VTT format, converting from SRT if necessary.
 * Throws if the content doesn't look like a valid subtitle file.
 */
export function ensureVtt(content: string, filename?: string): string {
  const format = detectSubtitleFormat(content);
  console.log("[subtitles] ensureVtt", {
    filename,
    detectedFormat: format,
    contentLength: content.length,
    needsConversion: format === "srt",
  });

  if (format === "vtt") {
    console.log("[subtitles] already VTT, no conversion needed");
    return content;
  }

  if (format === "srt") {
    console.log("[subtitles] converting SRT → VTT");
    const result = srtToVtt(content);
    console.log("[subtitles] conversion complete, output length:", result.length);
    return result;
  }

  throw new Error(
    `Unrecognized subtitle format${filename ? ` for "${filename}"` : ""}. Please upload a .srt or .vtt file.`
  );
}

/**
 * Build the subtitle sidecar path from a video path.
 * e.g. "movies/The Matrix (1999).mp4" → "movies/The Matrix (1999).en.vtt"
 */
export function buildSubtitlePath(videoRelPath: string, lang = "en"): string {
  const lastDot = videoRelPath.lastIndexOf(".");
  const base = lastDot >= 0 ? videoRelPath.substring(0, lastDot) : videoRelPath;
  return `${base}.${lang}.vtt`;
}
