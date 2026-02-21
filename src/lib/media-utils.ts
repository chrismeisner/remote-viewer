"use client";

import { type MediaSource, REMOTE_MEDIA_BASE } from "@/constants/media";

export type MediaFile = {
  relPath: string;
  title?: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  videoCodec?: string;
  audioCodec?: string;
  dateAdded?: string;
  // Frame rate info for health checks
  rFrameRate?: string;
  avgFrameRate?: string;
  frameRateMode?: "cfr" | "vfr" | "unknown";
  // Video resolution
  videoWidth?: number;
  videoHeight?: number;
};

export type TargetResolution = "original" | "720";

export type MediaType = "film" | "tv" | "documentary" | "sports" | "concert" | "other";

export type MediaMetadata = {
  title?: string | null;
  year?: number | null;
  releaseDate?: string | null; // ISO date string for exact release date (theatrical or event date)
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: MediaType | null;
  season?: number | null;
  episode?: number | null;
  imdbUrl?: string | null; // URL to IMDB page for the media
  eventUrl?: string | null; // URL to external event page for sporting events
  dateAdded?: string | null;
  lastUpdated?: string | null;
  coverUrl?: string | null;
  coverLocal?: string | null;
  coverPath?: string | null; // Full filesystem path for local mode
  coverEmoji?: string | null; // Emoji to use as cover (alternative to image)
  tags?: string[] | null; // Flexible tags for actors, themes, keywords, etc.
  subtitleFile?: string | null; // Relative path to .vtt subtitle sidecar file
};

export type CoverOption = {
  filename: string;
  url: string;
};

export type MediaHealthStatus = {
  isHealthy: boolean;
  issues: MediaHealthIssue[];
  frameRateMode?: "cfr" | "vfr" | "unknown";
  avgFps?: number;
};

export type MediaHealthIssue = 
  | "vfr"           // Variable frame rate detected
  | "vfr_suspected" // VFR likely based on frame rate mismatch
  | "low_fps"       // Unusually low frame rate
  | "audio_mismatch"; // Audio codec that may cause sync issues

export function parseFrameRate(value: string): number | null {
  if (!value || value === "0/0") return null;
  const parts = value.split("/");
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }
  const asNum = Number(value);
  return Number.isFinite(asNum) ? asNum : null;
}

export function computeMediaHealth(file: MediaFile): MediaHealthStatus {
  const issues: MediaHealthIssue[] = [];
  
  // Parse average frame rate for additional checks
  const avgFps = file.avgFrameRate ? parseFrameRate(file.avgFrameRate) : null;
  
  // Check for VFR
  if (file.frameRateMode === "vfr") {
    issues.push("vfr");
  } else if (file.frameRateMode === "unknown" && file.rFrameRate && file.avgFrameRate) {
    // If we have rates but couldn't determine mode, check for suspicious patterns
    const rFps = parseFrameRate(file.rFrameRate);
    if (rFps && avgFps && Math.abs(rFps - avgFps) > 0.5) {
      issues.push("vfr_suspected");
    }
  }
  
  // Check for unusually low frame rate (could indicate issues)
  if (avgFps !== null && avgFps > 0 && avgFps < 15) {
    issues.push("low_fps");
  }
  
  // Check for audio codecs known to cause sync issues in browsers
  const problematicAudioCodecs = ["ac3", "eac3", "dts", "truehd", "flac", "pcm"];
  if (file.audioCodec) {
    const codec = file.audioCodec.toLowerCase();
    if (problematicAudioCodecs.some(p => codec.includes(p))) {
      issues.push("audio_mismatch");
    }
  }
  
  return {
    isHealthy: issues.length === 0,
    issues,
    frameRateMode: file.frameRateMode,
    avgFps: avgFps ?? undefined,
  };
}

export function getMediaHealthIssueDescription(issue: MediaHealthIssue): string {
  switch (issue) {
    case "vfr":
      return "Variable frame rate (VFR) detected — may cause audio sync drift over time";
    case "vfr_suspected":
      return "Variable frame rate suspected — could cause audio sync issues";
    case "low_fps":
      return "Unusually low frame rate — may affect playback smoothness";
    case "audio_mismatch":
      return "Audio codec may cause sync issues in browsers";
    default:
      return "Unknown issue";
  }
}

export function getMediaHealthStatusLabel(health: MediaHealthStatus): { 
  label: string; 
  color: "green" | "yellow" | "red";
  shortLabel: string;
} {
  if (health.isHealthy) {
    return { label: "Healthy", color: "green", shortLabel: "OK" };
  }
  
  // VFR is the most serious issue for sync
  if (health.issues.includes("vfr")) {
    return { label: "VFR Detected", color: "red", shortLabel: "VFR" };
  }
  
  if (health.issues.includes("vfr_suspected")) {
    return { label: "VFR Suspected", color: "yellow", shortLabel: "VFR?" };
  }
  
  if (health.issues.includes("audio_mismatch")) {
    return { label: "Audio Issue", color: "yellow", shortLabel: "Audio" };
  }
  
  return { label: "Issues Found", color: "yellow", shortLabel: "!" };
}

export function needsSyncFix(file: MediaFile): boolean {
  const health = computeMediaHealth(file);
  return health.issues.includes("vfr") || health.issues.includes("vfr_suspected");
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  }
  return `${minutes}m`;
}

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateAdded(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Audio codecs that browsers can't play natively
export const UNSUPPORTED_AUDIO_CODECS = ["ac3", "eac3", "dts", "truehd", "dts-hd", "dtshd", "pcm_s16le", "pcm_s24le", "pcm_s32le", "flac"];

export function hasUnsupportedAudio(file: MediaFile): boolean {
  if (!file.audioCodec) return false;
  const codec = file.audioCodec.toLowerCase();
  return UNSUPPORTED_AUDIO_CODECS.some(unsupported => codec.includes(unsupported));
}

export function isBrowserSupported(file: MediaFile): boolean {
  if (hasUnsupportedAudio(file)) return false;
  return file.supported || file.supportedViaCompanion;
}

// Check if an unsupported file has a supported version in the same folder
export function checkHasSupportedVersion(file: MediaFile, allFiles: MediaFile[]): boolean {
  // Get the folder path and base name (without extension)
  const lastSlash = file.relPath.lastIndexOf("/");
  const folder = lastSlash >= 0 ? file.relPath.substring(0, lastSlash) : "";
  const filename = lastSlash >= 0 ? file.relPath.substring(lastSlash + 1) : file.relPath;
  const lastDot = filename.lastIndexOf(".");
  const baseName = lastDot >= 0 ? filename.substring(0, lastDot).toLowerCase() : filename.toLowerCase();
  
  // Find other files in the same folder with matching base name that are supported
  return allFiles.some((f) => {
    if (f.relPath === file.relPath) return false; // Skip self
    
    // Check if in same folder
    const fLastSlash = f.relPath.lastIndexOf("/");
    const fFolder = fLastSlash >= 0 ? f.relPath.substring(0, fLastSlash) : "";
    if (fFolder !== folder) return false;
    
    // Check if base name matches
    const fFilename = fLastSlash >= 0 ? f.relPath.substring(fLastSlash + 1) : f.relPath;
    const fLastDot = fFilename.lastIndexOf(".");
    const fBaseName = fLastDot >= 0 ? fFilename.substring(0, fLastDot).toLowerCase() : fFilename.toLowerCase();
    if (fBaseName !== baseName) return false;
    
    // Check if this alternative is supported
    return isBrowserSupported(f);
  });
}

export function isAlreadyOptimal(file: MediaFile): boolean {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  // Optimal format: MP4 with H.264 video and AAC audio
  if (ext !== "mp4" && ext !== "m4v") return false;
  if (hasUnsupportedAudio(file)) return false;
  if (needsFullReencode(file)) return false;
  // VFR files need re-encoding for sync, not optimal even if format is correct
  if (needsSyncFix(file)) return false;
  // Check if audio is already AAC
  const audioCodec = file.audioCodec?.toLowerCase() || "";
  if (audioCodec && audioCodec !== "aac") return false;
  return file.supported && !file.supportedViaCompanion;
}

export function needsFullReencode(file: MediaFile): boolean {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const filename = file.relPath.toLowerCase();
  const codec = (file.videoCodec || "").toLowerCase();
  
  // Extensions that always need full re-encoding (legacy formats)
  const fullReencodeExtensions = ["avi", "wmv", "asf", "flv", "mpeg", "mpg", "vob", "ogv", "ogg", "3gp", "3g2", "webm"];
  
  // Check actual codec from ffprobe first (most reliable)
  const codecIsH264 = codec.includes("h264") || codec.includes("avc");
  const codecIsHevc = codec.includes("hevc") || codec.includes("h265");
  const codecIsVp8 = codec.includes("vp8");
  const codecIsVp9 = codec.includes("vp9");
  
  // If we have actual codec info, use it
  if (codec) {
    // Only H.264/AVC can be safely copied for browser playback
    // VP8/VP9 in WebM is browser-compatible but we convert to H.264 for broader support
    if (codecIsH264) return false;  // H.264 can be copied
    return true;  // Everything else (HEVC, VP9, MPEG-2, etc.) needs re-encoding
  }
  
  // Fallback to filename hints when no codec info available
  const nameIsH264 = filename.includes("x264") || 
                     filename.includes("h264") || 
                     filename.includes("h.264") ||
                     filename.includes("avc");
  
  const nameIsHevc = filename.includes("x265") ||
                     filename.includes("hevc") ||
                     filename.includes("h265") ||
                     filename.includes("h.265");
  
  // AVI with H.264 indicator can be remuxed
  if (ext === "avi" && nameIsH264) return false;
  
  // Legacy formats always need re-encoding
  if (fullReencodeExtensions.includes(ext)) return true;
  
  // HEVC indicators in filename mean re-encode
  if (nameIsHevc) return true;
  
  // For MKV/MP4/MOV without codec info or filename hints, be conservative:
  // - If filename suggests H.264, we can copy
  // - Otherwise, safer to re-encode since we can't verify codec
  if (["mkv", "mp4", "m4v", "mov"].includes(ext)) {
    if (nameIsH264) return false;  // Filename suggests H.264, can copy
    // No codec info and no H.264 hint - safer to re-encode
    return true;
  }
  
  return false;
}

export function needsAudioOnlyConversion(file: MediaFile): boolean {
  // Check if it's a compatible container with just bad audio
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const compatibleContainers = ["mp4", "m4v", "mov"];
  if (!compatibleContainers.includes(ext)) return false;
  if (needsFullReencode(file)) return false;
  return hasUnsupportedAudio(file);
}

export function getConversionDescription(file: MediaFile, targetResolution: TargetResolution = "original"): string {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const filename = file.relPath.toLowerCase();
  
  const isH264 = filename.includes("x264") || 
                 filename.includes("h264") || 
                 filename.includes("h.264") ||
                 filename.includes("avc");
  
  // Check if downsizing to 720p
  const currentHeight = file.videoHeight || 0;
  const isDownsizingTo720 = targetResolution === "720" && currentHeight > 720;
  const resolutionNote = isDownsizingTo720 
    ? ` Will downscale to 720p (from ${currentHeight}p) for smaller file size.`
    : "";
  
  // Check for VFR/sync issues first - these need full re-encode regardless of other factors
  const fixSync = needsSyncFix(file);
  if (fixSync) {
    const baseDesc = file.frameRateMode === "vfr" 
      ? "Variable frame rate (VFR) detected"
      : "Variable frame rate suspected";
    return `${baseDesc} — will re-encode to CFR with continuous audio resampling (aresample async=1000) to prevent drift during playback.${resolutionNote}`;
  }
  
  // If downsizing to 720p, note that re-encoding is required
  if (isDownsizingTo720) {
    return `Will re-encode to 720p (from ${currentHeight}p) with H.264 + AAC for smaller file size.`;
  }
  
  // Check if already optimal
  if (isAlreadyOptimal(file)) {
    return "Already in optimal format (MP4 + H.264 + AAC). Re-running will create a copy with optimized streaming flags.";
  }
  
  // Check for audio-only conversion case first
  if (needsAudioOnlyConversion(file)) {
    const audioCodec = file.audioCodec?.toUpperCase() || "unknown";
    return `${ext.toUpperCase()} has ${audioCodec} audio which browsers can't play. Video will be copied, audio converted to AAC.`;
  }
  
  switch (ext) {
    case "avi":
      if (isH264) {
        return "AVI with H.264 - will remux to MP4 with AAC audio.";
      }
      return "AVI files (XviD/DivX) need full re-encoding to H.264 for browser playback.";
    case "wmv":
    case "asf":
      return "Windows Media files need full re-encoding to H.264.";
    case "flv":
      return "Flash Video needs full re-encoding to H.264.";
    case "mov":
      if (needsFullReencode(file)) {
        return "QuickTime with HEVC needs re-encoding to H.264.";
      }
      return "QuickTime file - will remux to MP4 with AAC audio for optimal compatibility.";
    case "mkv":
      if (needsFullReencode(file)) {
        return "MKV with HEVC/x265 needs re-encoding to H.264 for browser support.";
      }
      return "MKV will be remuxed to MP4 with AAC audio (video stream copied).";
    case "mpeg":
    case "mpg":
    case "vob":
      return "MPEG/DVD format needs full re-encoding to H.264.";
    case "webm":
      return "WebM will be converted to MP4 with H.264 + AAC for broader compatibility.";
    case "ogv":
    case "ogg":
      return "Ogg/Theora needs full re-encoding to H.264.";
    case "3gp":
    case "3g2":
      return "Mobile format needs re-encoding to H.264.";
    case "mp4":
    case "m4v":
      if (needsFullReencode(file)) {
        return "MP4 with HEVC/x265 needs re-encoding to H.264 for browser support.";
      }
      const audioCodec = file.audioCodec?.toLowerCase() || "";
      if (audioCodec && audioCodec !== "aac") {
        return `MP4 with ${audioCodec.toUpperCase()} audio - will convert audio to AAC (video copied).`;
      }
      return "MP4 will be optimized with faststart flag for better streaming.";
    default:
      return "Will convert to MP4 with H.264 video and AAC audio for optimal browser compatibility.";
  }
}

export function copyConvertCommand(
  file: MediaFile,
  mediaRoot: string,
  setCopied: (value: boolean) => void,
  targetResolution: TargetResolution = "original",
) {
  const cmd = buildConvertCommand(file, mediaRoot, targetResolution);
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard
      .writeText(cmd)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  } else {
    setCopied(false);
    window.prompt("Copy this command", cmd);
  }
}

export function buildConvertCommand(file: MediaFile, mediaRoot: string, targetResolution: TargetResolution = "original"): string {
  const escapedIn = escapeDoubleQuotes(file.relPath);
  const base = file.relPath.replace(/\.[^/.]+$/, "");
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  
  // Check if we need sync-safe conversion (VFR detected)
  const fixSync = needsSyncFix(file);
  
  // Check if we're downsizing to 720p
  const currentHeight = file.videoHeight || 0;
  const isDownsizingTo720 = targetResolution === "720" && currentHeight > 720;
  
  // Determine output filename suffix based on conversion type
  let outName: string;
  const resolutionSuffix = isDownsizingTo720 ? "_720p" : "";
  if (ext === "mp4" || ext === "m4v") {
    if (needsFullReencode(file) || fixSync || isDownsizingTo720) {
      outName = `${base}_h264${resolutionSuffix}.mp4`;  // Re-encoded from HEVC to H.264, or VFR fix, or resolution change
    } else if (isAlreadyOptimal(file) && !fixSync) {
      outName = `${base}_optimized.mp4`;  // Already optimal, just adding faststart
    } else {
      outName = `${base}_aac.mp4`;   // Audio-only conversion
    }
  } else {
    outName = `${base}${resolutionSuffix}.mp4`;
  }
  const escapedOut = escapeDoubleQuotes(outName);
  const escapedRoot = escapeDoubleQuotes(mediaRoot);
  const inputPath = `"${escapedRoot}/${escapedIn}"`;
  const outputPath = `"${escapedRoot}/${escapedOut}"`;
  
  // -n flag prevents overwriting existing files (never prompts, just exits if file exists)
  
  // Browser-compatible H.264 encoding settings:
  // - profile:v high -level 4.1: Ensures broad browser/device compatibility
  // - pix_fmt yuv420p: 8-bit color required for browser playback (HEVC sources often use 10-bit)
  // - ac 2: Downmix to stereo for reliable browser audio playback
  // Scale filter for 720p: -vf scale=-2:720 (maintains aspect ratio, -2 ensures even width)
  const scaleFilter = isDownsizingTo720 ? "-vf scale=-2:720" : "";
  const h264Encode = `-c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -preset medium -crf 18${scaleFilter ? ` ${scaleFilter}` : ""}`;
  const aacEncode = "-c:a aac -ac 2 -b:a 192k";
  const faststart = "-movflags +faststart";
  
  // Input flags for fixing broken timestamps:
  // - fflags +genpts: Regenerate presentation timestamps from scratch
  const inputFlags = fixSync ? "-fflags +genpts" : "";
  
  // Sync-fixing flags for VFR content:
  // - fps_mode cfr: Force constant frame rate output (modern replacement for deprecated -vsync cfr)
  // - aresample filter with async=1000: Continuously resamples audio to stay in sync,
  //   correcting up to 1000 samples/sec of drift (much better than old -async 1 which only corrects once)
  // - first_pts=0: Ensures audio starts aligned with video
  const syncVideoFix = fixSync ? "-fps_mode cfr" : "";
  const syncAudioFilter = fixSync ? '-af "aresample=async=1000:first_pts=0"' : "";
  
  // If VFR is detected, we need to re-encode even if otherwise optimal
  // because stream copy won't fix the frame timing issues
  if (fixSync) {
    // VFR files need full re-encode to fix sync
    // Order: input flags, input, video encode, fps mode, audio filter, audio encode, faststart, output
    return `ffmpeg -n ${inputFlags} -i ${inputPath} ${h264Encode} ${syncVideoFix} ${syncAudioFilter} ${aacEncode} ${faststart} ${outputPath}`;
  }
  
  // If downsizing to 720p, always need to re-encode (can't copy stream when resizing)
  if (isDownsizingTo720) {
    return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
  }
  
  // Already optimal files - just copy with faststart for streaming optimization
  if (isAlreadyOptimal(file)) {
    return `ffmpeg -n -i ${inputPath} -c:v copy -c:a copy ${faststart} ${outputPath}`;
  }
  
  switch (ext) {
    case "avi":
      if (file.relPath.toLowerCase().includes("x264") || 
          file.relPath.toLowerCase().includes("h264") ||
          file.relPath.toLowerCase().includes("h.264")) {
        return `ffmpeg -n -i ${inputPath} -c:v copy ${aacEncode} ${faststart} ${outputPath}`;
      }
      return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
    
    case "wmv":
    case "asf":
      return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
    
    case "flv":
      return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
    
    case "mov":
      if (needsFullReencode(file)) {
        return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
      }
      return `ffmpeg -n -i ${inputPath} -c:v copy ${aacEncode} ${faststart} ${outputPath}`;
    
    case "mkv":
      if (needsFullReencode(file)) {
        return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
      }
      return `ffmpeg -n -i ${inputPath} -c:v copy ${aacEncode} ${faststart} ${outputPath}`;
    
    case "mpeg":
    case "mpg":
    case "vob":
      return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
    
    case "ts":
    case "m2ts":
    case "mts":
      return `ffmpeg -n -i ${inputPath} -c:v copy ${aacEncode} ${faststart} ${outputPath}`;
    
    case "webm":
      return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
    
    case "ogv":
    case "ogg":
      return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
    
    case "3gp":
    case "3g2":
      return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
    
    case "mp4":
    case "m4v":
      if (needsFullReencode(file)) {
        return `ffmpeg -n -i ${inputPath} ${h264Encode} ${aacEncode} ${faststart} ${outputPath}`;
      }
      return `ffmpeg -n -i ${inputPath} -c:v copy ${aacEncode} ${faststart} ${outputPath}`;
    
    default:
      return `ffmpeg -n -i ${inputPath} -c:v copy ${aacEncode} ${faststart} ${outputPath}`;
  }
}

export function escapeDoubleQuotes(value: string): string {
  return value.replace(/(["\\`$])/g, "\\$1");
}

