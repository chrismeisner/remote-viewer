"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

type MediaFile = {
  relPath: string;
  title?: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  audioCodec?: string;
};

type MediaType = "film" | "tv" | "documentary" | "sports" | "concert" | "other";

type MediaMetadata = {
  title?: string | null;
  year?: number | null;
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: MediaType | null;
  season?: number | null;
  episode?: number | null;
};

type FileResult = {
  file: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  probeSuccess: boolean;
  probeError?: string;
  wasReprobed?: boolean;
  wasCached?: boolean;
};

type ScanStats = {
  total: number;
  withDuration: number;
  zeroDuration: number;
  probeSuccessCount: number;
  probeFailCount: number;
  reprobedCount: number;
  fixedCount: number;
  cachedCount: number;
};

type ScanReport = {
  fileResults: FileResult[];
  stats: ScanStats;
  message: string;
};

/* ─────────────────────────────────────────────────────────────────────────────
   Media Detail Modal Component
   ───────────────────────────────────────────────────────────────────────────── */
function MediaDetailModal({
  item,
  mediaSource,
  mediaRoot,
  onClose,
  onMetadataUpdate,
}: {
  item: MediaFile;
  mediaSource: MediaSource;
  mediaRoot: string;
  onClose: () => void;
  onMetadataUpdate?: (relPath: string, metadata: MediaMetadata) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.durationSeconds || 0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);

  // Metadata state
  const [metadata, setMetadata] = useState<MediaMetadata>({});
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editYear, setEditYear] = useState<string>("");
  const [editDirector, setEditDirector] = useState<string>("");
  const [editCategory, setEditCategory] = useState<string>("");
  const [editMakingOf, setEditMakingOf] = useState<string>("");
  const [editPlot, setEditPlot] = useState<string>("");
  const [editType, setEditType] = useState<string>("");
  const [editSeason, setEditSeason] = useState<string>("");
  const [editEpisode, setEditEpisode] = useState<string>("");
  
  // AI lookup state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiTokenLevel, setAiTokenLevel] = useState<"fast" | "balanced" | "detailed">("balanced");

  // Check if AI is configured
  useEffect(() => {
    fetch("/api/media-metadata/ai-lookup")
      .then((res) => res.json())
      .then((data) => setAiConfigured(data.configured === true))
      .catch(() => setAiConfigured(false));
  }, []);

  // Fetch metadata when modal opens
  useEffect(() => {
    let cancelled = false;
    setMetadataLoading(true);
    setMetadataError(null);

    fetch(`/api/media-metadata?file=${encodeURIComponent(item.relPath)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.metadata) {
          setMetadata(data.metadata);
          setEditTitle(data.metadata.title ?? "");
          setEditYear(data.metadata.year?.toString() ?? "");
          setEditDirector(data.metadata.director ?? "");
          setEditCategory(data.metadata.category ?? "");
          setEditMakingOf(data.metadata.makingOf ?? "");
          setEditPlot(data.metadata.plot ?? "");
          setEditType(data.metadata.type ?? "");
          setEditSeason(data.metadata.season?.toString() ?? "");
          setEditEpisode(data.metadata.episode?.toString() ?? "");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMetadataError(err.message || "Failed to load metadata");
        }
      })
      .finally(() => {
        if (!cancelled) setMetadataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.relPath]);

  // AI lookup to fill metadata fields
  const handleAiLookup = async () => {
    setAiLoading(true);
    setMetadataError(null);
    try {
      // Include existing metadata as context for AI
      const existingMetadata: Record<string, unknown> = {};
      if (metadata.title) existingMetadata.title = metadata.title;
      if (metadata.year) existingMetadata.year = metadata.year;
      if (metadata.director) existingMetadata.director = metadata.director;
      if (metadata.category) existingMetadata.category = metadata.category;
      if (metadata.makingOf) existingMetadata.makingOf = metadata.makingOf;
      if (metadata.plot) existingMetadata.plot = metadata.plot;
      if (metadata.type) existingMetadata.type = metadata.type;
      if (metadata.season) existingMetadata.season = metadata.season;
      if (metadata.episode) existingMetadata.episode = metadata.episode;

      // Map token level to actual token count
      const tokenMap = { fast: 256, balanced: 512, detailed: 1024 };
      const maxTokens = tokenMap[aiTokenLevel];

      const res = await fetch("/api/media-metadata/ai-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          filename: item.relPath,
          existingMetadata: Object.keys(existingMetadata).length > 0 ? existingMetadata : undefined,
          maxTokens,
        }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "AI lookup failed");
      }
      
      // Fill in the edit fields with AI response
      if (data.title) setEditTitle(data.title);
      if (data.year) setEditYear(data.year.toString());
      if (data.director) setEditDirector(data.director);
      if (data.category) setEditCategory(data.category);
      if (data.makingOf) setEditMakingOf(data.makingOf);
      if (data.plot) setEditPlot(data.plot);
      if (data.type) setEditType(data.type);
      if (data.season) setEditSeason(data.season.toString());
      if (data.episode) setEditEpisode(data.episode.toString());
      
      // Switch to edit mode to show the filled fields
      setEditingMetadata(true);
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : "AI lookup failed");
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveMetadata = async () => {
    setMetadataSaving(true);
    setMetadataError(null);
    try {
      const res = await fetch("/api/media-metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: item.relPath,
          title: editTitle.trim() || null,
          year: editYear ? parseInt(editYear, 10) : null,
          director: editDirector.trim() || null,
          category: editCategory.trim() || null,
          makingOf: editMakingOf.trim() || null,
          plot: editPlot.trim() || null,
          type: editType || null,
          season: editSeason ? parseInt(editSeason, 10) : null,
          episode: editEpisode ? parseInt(editEpisode, 10) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save");
      }
      setMetadata(data.metadata);
      setEditingMetadata(false);
      // Notify parent to update the table
      onMetadataUpdate?.(item.relPath, data.metadata);
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setMetadataSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditTitle(metadata.title ?? "");
    setEditYear(metadata.year?.toString() ?? "");
    setEditDirector(metadata.director ?? "");
    setEditCategory(metadata.category ?? "");
    setEditMakingOf(metadata.makingOf ?? "");
    setEditPlot(metadata.plot ?? "");
    setEditType(metadata.type ?? "");
    setEditSeason(metadata.season?.toString() ?? "");
    setEditEpisode(metadata.episode?.toString() ?? "");
    setEditingMetadata(false);
    setMetadataError(null);
  };

  const handleMetadataKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !metadataSaving) {
      e.preventDefault();
      handleSaveMetadata();
    }
  };

  // Build the video URL based on media source
  const videoUrl =
    mediaSource === "remote"
      ? `${REMOTE_MEDIA_BASE}${item.relPath}`
      : `/api/media?file=${encodeURIComponent(item.relPath)}`;

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Reset copied state when item changes
  useEffect(() => {
    setCopiedCommand(false);
  }, [item]);

  // Update time display
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  }, []);

  const handleError = useCallback(() => {
    setError("Failed to load video. The format may not be supported by your browser.");
    setIsLoading(false);
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const fileName = item.relPath.split("/").pop() || item.relPath;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-neutral-800/50 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-neutral-50 truncate" title={fileName}>
              {fileName}
            </h2>
            <p className="text-xs text-neutral-400 truncate font-mono" title={item.relPath}>
              {item.relPath}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex-shrink-0 rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-neutral-100 transition"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video Player */}
        <div className="relative bg-black aspect-video">
          {isLoading && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-3 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
                <p className="text-sm text-neutral-400">Loading video...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/20 mb-4">
                  <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-sm text-amber-200 mb-2">Unable to preview</p>
                <p className="text-xs text-neutral-400 max-w-xs">{error}</p>
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            src={videoUrl}
            className={`w-full h-full object-contain ${isLoading || error ? "opacity-0" : "opacity-100"}`}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleError}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            preload="metadata"
          />
        </div>

        {/* Video Controls */}
        {!error && (
          <div className="border-t border-white/10 bg-neutral-800/70 px-4 py-3">
            {/* Progress bar */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs text-neutral-400 w-14 text-right font-mono">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-1.5 rounded-full appearance-none bg-neutral-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-emerald-500/30"
              />
              <span className="text-xs text-neutral-400 w-14 font-mono">
                {formatTime(duration)}
              </span>
            </div>

            {/* Playback controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-400 text-neutral-900 transition shadow-lg shadow-emerald-500/30"
                  disabled={isLoading}
                >
                  {isPlaying ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Volume control */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/10 transition"
                >
                  {isMuted || volume === 0 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1 rounded-full appearance-none bg-neutral-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-300"
                />
              </div>
            </div>
          </div>
        )}

        {/* Media Details */}
        <div className="border-t border-white/10 bg-neutral-800/30 px-5 py-4">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3">Media Details</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div>
              <p className="text-xs text-neutral-500 mb-1">Format</p>
              <p className="text-sm font-medium text-neutral-200 uppercase">
                {item.format || "Unknown"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">Audio</p>
              <p className="text-sm font-medium text-neutral-200 uppercase">
                {item.audioCodec || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">Duration</p>
              <p className="text-sm font-medium text-neutral-200">
                {item.durationSeconds ? formatTime(item.durationSeconds) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">Playback</p>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isBrowserSupported(item)
                      ? item.supportedViaCompanion
                        ? "bg-blue-500/20 text-blue-200"
                        : "bg-emerald-500/20 text-emerald-200"
                      : "bg-amber-500/20 text-amber-200"
                }`}
              >
                  {isBrowserSupported(item)
                    ? item.supportedViaCompanion
                      ? "Companion"
                      : "Native"
                    : hasUnsupportedAudio(item)
                      ? "Unsupported (audio)"
                      : "Unsupported"}
              </span>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">Source</p>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                  mediaSource === "remote"
                    ? "bg-blue-500/20 text-blue-200"
                    : "bg-emerald-500/20 text-emerald-200"
                }`}
              >
                {mediaSource === "remote" ? "CDN" : "Local"}
              </span>
            </div>
          </div>
          {item.title && (
            <div className="mt-4 pt-3 border-t border-white/5">
              <p className="text-xs text-neutral-500 mb-1">Title</p>
              <p className="text-sm text-neutral-200">{item.title}</p>
            </div>
          )}

          {/* Conversion Helper - always show for all files */}
          <div className="mt-4 pt-3 border-t border-white/5 space-y-2">
            <p className="text-xs text-neutral-400">
              {getConversionDescription(item)}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyConvertCommand(item, mediaRoot, setCopiedCommand)}
                className="rounded-md border border-white/20 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30"
              >
                {copiedCommand ? "Copied!" : "Copy conversion command"}
              </button>
              <span className={`text-xs px-2 py-1 rounded-full ${
                isAlreadyOptimal(item)
                  ? "bg-emerald-500/20 text-emerald-200"
                  : needsFullReencode(item)
                  ? "bg-amber-500/20 text-amber-200"
                  : needsAudioOnlyConversion(item)
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-blue-500/20 text-blue-200"
              }`}>
                {isAlreadyOptimal(item) 
                  ? "Already optimal" 
                  : needsFullReencode(item) 
                  ? "Full re-encode" 
                  : needsAudioOnlyConversion(item) 
                  ? "Audio only" 
                  : "Remux + audio"}
              </span>
            </div>
          </div>
        </div>

        {/* Media Metadata Section */}
        <div className="border-t border-white/10 bg-neutral-800/30 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs uppercase tracking-widest text-neutral-500">Media Metadata</h3>
            {!metadataLoading && (
              <div className="flex items-center gap-3">
                {aiConfigured && (
                  <div className="flex items-center gap-2">
                    <select
                      value={aiTokenLevel}
                      onChange={(e) => setAiTokenLevel(e.target.value as "fast" | "balanced" | "detailed")}
                      disabled={aiLoading}
                      className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-300 outline-none focus:border-blue-300 disabled:opacity-50"
                      title="AI detail level"
                    >
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="detailed">Detailed</option>
                    </select>
                    <button
                      onClick={handleAiLookup}
                      disabled={aiLoading}
                      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition disabled:opacity-50"
                    >
                      {aiLoading ? (
                        <>
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Looking up...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Fill with AI
                        </>
                      )}
                    </button>
                  </div>
                )}
                {!editingMetadata && (
                  <button
                    onClick={() => setEditingMetadata(true)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>

          {metadataLoading ? (
            <p className="text-sm text-neutral-400">Loading metadata...</p>
          ) : editingMetadata ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleMetadataKeyDown}
                  placeholder="e.g. The Matrix"
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Type</label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                    className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-300 focus:bg-white/10"
                  >
                    <option value="">Select...</option>
                    <option value="film">Film</option>
                    <option value="tv">TV Show</option>
                    <option value="documentary">Documentary</option>
                    <option value="sports">Sports</option>
                    <option value="concert">Concert</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Year</label>
                  <input
                    type="number"
                    value={editYear}
                    onChange={(e) => setEditYear(e.target.value)}
                    onKeyDown={handleMetadataKeyDown}
                    placeholder="e.g. 1999"
                    min="1800"
                    max="2100"
                    className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Season</label>
                  <input
                    type="number"
                    value={editSeason}
                    onChange={(e) => setEditSeason(e.target.value)}
                    onKeyDown={handleMetadataKeyDown}
                    placeholder="e.g. 2"
                    min="1"
                    className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Episode</label>
                  <input
                    type="number"
                    value={editEpisode}
                    onChange={(e) => setEditEpisode(e.target.value)}
                    onKeyDown={handleMetadataKeyDown}
                    placeholder="e.g. 8"
                    min="1"
                    className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Director / Creator</label>
                  <input
                    type="text"
                    value={editDirector}
                    onChange={(e) => setEditDirector(e.target.value)}
                    onKeyDown={handleMetadataKeyDown}
                    placeholder="e.g. Stanley Kubrick"
                    className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Category</label>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    onKeyDown={handleMetadataKeyDown}
                    placeholder="e.g. Sci-Fi, Comedy"
                    className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Making Of <span className="text-neutral-600">(cast, crew, production facts)</span></label>
                <textarea
                  value={editMakingOf}
                  onChange={(e) => setEditMakingOf(e.target.value)}
                  placeholder="Main actors, who directed/produced it, filming locations, budget, awards..."
                  rows={2}
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Plot <span className="text-neutral-600">(episode/movie specific)</span></label>
                <textarea
                  value={editPlot}
                  onChange={(e) => setEditPlot(e.target.value)}
                  placeholder="What happens in this specific episode or movie..."
                  rows={2}
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10 resize-none"
                />
              </div>
              {metadataError && (
                <p className="text-xs text-amber-300">{metadataError}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveMetadata}
                  disabled={metadataSaving}
                  className="rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-neutral-900 transition disabled:opacity-50"
                >
                  {metadataSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={metadataSaving}
                  className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-neutral-300 transition hover:bg-white/10 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-xs text-neutral-500 mb-1">Title</p>
                  <p className="text-sm font-medium text-neutral-200">
                    {metadata.title ?? <span className="text-neutral-500 italic">Not set</span>}
                  </p>
                </div>
                {metadata.type && (
                  <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    metadata.type === "film" ? "bg-purple-500/20 text-purple-200" :
                    metadata.type === "tv" ? "bg-blue-500/20 text-blue-200" :
                    metadata.type === "documentary" ? "bg-amber-500/20 text-amber-200" :
                    metadata.type === "sports" ? "bg-green-500/20 text-green-200" :
                    metadata.type === "concert" ? "bg-pink-500/20 text-pink-200" :
                    "bg-neutral-500/20 text-neutral-200"
                  }`}>
                    {metadata.type === "film" ? "Film" :
                     metadata.type === "tv" ? "TV Show" :
                     metadata.type === "documentary" ? "Documentary" :
                     metadata.type === "sports" ? "Sports" :
                     metadata.type === "concert" ? "Concert" :
                     "Other"}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-neutral-500 mb-1">Year</p>
                  <p className="text-sm font-medium text-neutral-200">
                    {metadata.year ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500 mb-1">Season</p>
                  <p className="text-sm font-medium text-neutral-200">
                    {metadata.season ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500 mb-1">Episode</p>
                  <p className="text-sm font-medium text-neutral-200">
                    {metadata.episode ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500 mb-1">Category</p>
                  <p className="text-sm font-medium text-neutral-200">
                    {metadata.category ?? "—"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-neutral-500 mb-1">Director / Creator</p>
                <p className="text-sm font-medium text-neutral-200">
                  {metadata.director ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500 mb-1">Making Of <span className="text-neutral-600">(cast, crew, production)</span></p>
                <p className="text-sm text-neutral-300">
                  {metadata.makingOf ?? <span className="text-neutral-500">—</span>}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500 mb-1">Plot <span className="text-neutral-600">(episode/movie specific)</span></p>
                <p className="text-sm text-neutral-300">
                  {metadata.plot ?? <span className="text-neutral-500">—</span>}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Scan Report Modal Component
   ───────────────────────────────────────────────────────────────────────────── */
function ScanReportModal({
  report,
  onClose,
}: {
  report: ScanReport;
  onClose: () => void;
}) {
  const [showAllFiles, setShowAllFiles] = useState(false);
  const { stats, fileResults, message } = report;
  
  // Separate files into categories
  const filesWithIssues = fileResults.filter(f => !f.probeSuccess || f.durationSeconds === 0);
  const filesFixed = fileResults.filter(f => f.wasReprobed && f.probeSuccess && f.durationSeconds > 0);
  const filesOk = fileResults.filter(f => f.probeSuccess && f.durationSeconds > 0);
  
  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);
  
  const formatDurationDisplay = (seconds: number): string => {
    if (seconds === 0) return "0m";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };
  
  const successRate = stats.total > 0 
    ? Math.round((stats.withDuration / stats.total) * 100)
    : 0;
  
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/60 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-neutral-800/50 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-neutral-50 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Scan Report
            </h2>
            <p className="text-xs text-neutral-400 mt-1">{message}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex-shrink-0 rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-neutral-100 transition"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Stats Summary */}
        <div className="p-5 border-b border-white/10 bg-neutral-800/30">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-neutral-50">{stats.total}</p>
              <p className="text-xs text-neutral-400">Total Files</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-400">{stats.withDuration}</p>
              <p className="text-xs text-neutral-400">With Duration</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${stats.zeroDuration > 0 ? 'text-amber-400' : 'text-neutral-500'}`}>
                {stats.zeroDuration}
              </p>
              <p className="text-xs text-neutral-400">Still Zero</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                {successRate}%
              </p>
              <p className="text-xs text-neutral-400">Success Rate</p>
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="mt-4">
            <div className="h-2 bg-neutral-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>
          
          {/* Scan details */}
          <div className="mt-4 flex flex-wrap gap-3 justify-center text-xs">
            {stats.cachedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-blue-500/20 text-blue-300">
                {stats.cachedCount} cached
              </span>
            )}
            {stats.reprobedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-purple-500/20 text-purple-300">
                {stats.reprobedCount} probed
              </span>
            )}
            {stats.fixedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300">
                {stats.fixedCount} fixed ✓
              </span>
            )}
          </div>
        </div>
        
        {/* File Lists */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Fixed files - celebrate these! */}
          {filesFixed.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-emerald-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Fixed This Scan ({filesFixed.length})
              </h3>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {filesFixed.map((file) => (
                  <div 
                    key={file.file} 
                    className="flex items-center gap-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
                  >
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-xs text-neutral-200 font-mono truncate flex-1" title={file.file}>
                      {file.file}
                    </p>
                    <span className="text-xs text-emerald-300">
                      {formatDurationDisplay(file.durationSeconds)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Files with issues */}
          {filesWithIssues.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-amber-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Still Need Attention ({filesWithIssues.length})
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {filesWithIssues.map((file) => (
                  <div 
                    key={file.file} 
                    className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-200 font-mono truncate" title={file.file}>
                        {file.file}
                      </p>
                      <p className="text-xs text-amber-300/80 mt-0.5">
                        {file.probeError || "Duration: 0m"}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <span className="text-xs px-2 py-1 rounded bg-neutral-700 text-neutral-300 uppercase">
                        {file.format}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Successfully scanned files */}
          {filesOk.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Successfully Scanned ({filesOk.length})
                </h3>
                <button
                  onClick={() => setShowAllFiles(!showAllFiles)}
                  className="text-xs text-neutral-400 hover:text-neutral-200 transition"
                >
                  {showAllFiles ? "Hide" : "Show all"}
                </button>
              </div>
              
              {showAllFiles && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {filesOk.map((file) => (
                    <div 
                      key={file.file} 
                      className="flex items-center gap-3 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10"
                    >
                      <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <p className="text-xs text-neutral-300 font-mono truncate flex-1" title={file.file}>
                        {file.file}
                      </p>
                      <span className="text-xs text-neutral-500">
                        {formatDurationDisplay(file.durationSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* All files OK message */}
          {filesWithIssues.length === 0 && filesOk.length > 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-emerald-300">All Files Scanned Successfully!</p>
              <p className="text-sm text-neutral-400 mt-1">
                All {stats.total} files have valid duration metadata.
              </p>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="border-t border-white/10 bg-neutral-800/50 px-5 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-blue-500 hover:bg-blue-400 px-4 py-2.5 text-sm font-semibold text-white transition shadow-lg shadow-blue-500/20"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MediaAdminPage() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [mediaRefreshToken, setMediaRefreshToken] = useState(0);
  const [scanningRemote, setScanningRemote] = useState(false);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [audioFilter, setAudioFilter] = useState<string>("all");
  const [supportedFilter, setSupportedFilter] = useState<"all" | "supported" | "unsupported">(
    "supported",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [manifestUpdatedAt, setManifestUpdatedAt] = useState<string | null>(null);
  const [mediaRoot, setMediaRoot] = useState<string>("media");
  const [allMetadata, setAllMetadata] = useState<Record<string, MediaMetadata>>({});
  
  // Bulk AI fill state
  const [bulkAiRunning, setBulkAiRunning] = useState(false);
  const [bulkAiProgress, setBulkAiProgress] = useState({ current: 0, total: 0, currentFile: "" });
  const bulkAiCancelledRef = useRef(false);
  const [aiConfiguredGlobal, setAiConfiguredGlobal] = useState(false);
  const [bulkAiSupportedOnly, setBulkAiSupportedOnly] = useState(true);
  
  // Bulk conversion command state
  const [selectedForConversion, setSelectedForConversion] = useState<Set<string>>(new Set());
  const [copiedBulkCommand, setCopiedBulkCommand] = useState(false);

  // Load media source preference from localStorage and stay in sync with other tabs/pages.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncSource = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      if (stored === "remote" || stored === "local") {
        setMediaSource(stored);
      }
    };
    syncSource();
    window.addEventListener("storage", syncSource);
    window.addEventListener(MEDIA_SOURCE_EVENT, syncSource);
    return () => {
      window.removeEventListener("storage", syncSource);
      window.removeEventListener(MEDIA_SOURCE_EVENT, syncSource);
    };
  }, []);

  // Fetch the effective media root path for conversion commands
  useEffect(() => {
    fetch("/api/source")
      .then((res) => res.json())
      .then((data) => {
        if (data.effectiveMediaRoot) {
          setMediaRoot(data.effectiveMediaRoot);
        }
      })
      .catch(() => {
        // Keep default "media" if fetch fails
      });
  }, []);

  // Fetch all metadata for table display (works for both local and remote sources)
  useEffect(() => {
    fetch("/api/media-metadata?withAutoYear=true")
      .then((res) => res.json())
      .then((data) => {
        if (data.items) {
          setAllMetadata(data.items);
        }
      })
      .catch(() => {
        // Ignore errors, metadata is optional
      });
  }, [mediaRefreshToken]);

  // Check if AI is configured (for bulk fill button)
  useEffect(() => {
    fetch("/api/media-metadata/ai-lookup")
      .then((res) => res.json())
      .then((data) => setAiConfiguredGlobal(data.configured === true))
      .catch(() => setAiConfiguredGlobal(false));
  }, []);

  // Bulk AI fill function
  const handleBulkAiFill = async (onlyEmpty: boolean) => {
    // Filter files to process
    let filesToProcess = onlyEmpty
      ? filteredFiles.filter((f) => {
          const meta = allMetadata[f.relPath];
          // Consider "empty" if no title is set
          return !meta?.title;
        })
      : filteredFiles;
    
    // Apply supported-only filter if checked
    if (bulkAiSupportedOnly) {
      filesToProcess = filesToProcess.filter((f) => isBrowserSupported(f));
    }

    if (filesToProcess.length === 0) {
      setError(onlyEmpty ? "All visible files already have metadata" : "No files to process");
      return;
    }

    setBulkAiRunning(true);
    bulkAiCancelledRef.current = false;
    setBulkAiProgress({ current: 0, total: filesToProcess.length, currentFile: "" });

    let successCount = 0;
    let errorCount = 0;
    let wasCancelled = false;

    for (let i = 0; i < filesToProcess.length; i++) {
      // Check if cancelled
      if (bulkAiCancelledRef.current) {
        wasCancelled = true;
        break;
      }

      const file = filesToProcess[i];
      setBulkAiProgress({ current: i + 1, total: filesToProcess.length, currentFile: file.relPath });

      try {
        // Get existing metadata for context
        const existingMeta = allMetadata[file.relPath] || {};
        const existingMetadata: Record<string, unknown> = {};
        if (existingMeta.title) existingMetadata.title = existingMeta.title;
        if (existingMeta.year) existingMetadata.year = existingMeta.year;
        if (existingMeta.director) existingMetadata.director = existingMeta.director;
        if (existingMeta.category) existingMetadata.category = existingMeta.category;
        if (existingMeta.makingOf) existingMetadata.makingOf = existingMeta.makingOf;
        if (existingMeta.plot) existingMetadata.plot = existingMeta.plot;
        if (existingMeta.type) existingMetadata.type = existingMeta.type;
        if (existingMeta.season) existingMetadata.season = existingMeta.season;
        if (existingMeta.episode) existingMetadata.episode = existingMeta.episode;

        // Call AI lookup with existing metadata context
        const lookupRes = await fetch("/api/media-metadata/ai-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            filename: file.relPath,
            existingMetadata: Object.keys(existingMetadata).length > 0 ? existingMetadata : undefined,
          }),
        });
        const lookupData = await lookupRes.json();

        if (!lookupRes.ok) {
          console.warn(`AI lookup failed for ${file.relPath}:`, lookupData.error);
          errorCount++;
          continue;
        }

        // Save the metadata
        const saveRes = await fetch("/api/media-metadata", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: file.relPath,
            title: lookupData.title || null,
            year: lookupData.year || null,
            director: lookupData.director || null,
            category: lookupData.category || null,
            makingOf: lookupData.makingOf || null,
            plot: lookupData.plot || null,
            type: lookupData.type || null,
            season: lookupData.season || null,
            episode: lookupData.episode || null,
          }),
        });
        const saveData = await saveRes.json();

        if (saveRes.ok) {
          // Update local state
          setAllMetadata((prev) => ({
            ...prev,
            [file.relPath]: saveData.metadata,
          }));
          successCount++;
        } else {
          console.warn(`Save failed for ${file.relPath}:`, saveData.error);
          errorCount++;
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (err) {
        console.error(`Error processing ${file.relPath}:`, err);
        errorCount++;
      }
    }

    setBulkAiRunning(false);
    setBulkAiProgress({ current: 0, total: 0, currentFile: "" });
    
    if (wasCancelled) {
      setMessage(`Cancelled. Processed ${successCount} files before stopping.`);
    } else {
      setMessage(`Done! Filled ${successCount} files${errorCount > 0 ? `, ${errorCount} errors` : ""}.`);
    }
  };

  const cancelBulkAiFill = () => {
    bulkAiCancelledRef.current = true;
  };

  // Toggle individual file selection for conversion
  const toggleFileSelection = (relPath: string) => {
    setSelectedForConversion((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(relPath)) {
        newSet.delete(relPath);
      } else {
        newSet.add(relPath);
      }
      return newSet;
    });
    setCopiedBulkCommand(false);
  };

  // Toggle all visible files
  const toggleAllVisible = () => {
    if (selectedForConversion.size === filteredFiles.length) {
      // All are selected, deselect all
      setSelectedForConversion(new Set());
    } else {
      // Select all visible
      setSelectedForConversion(new Set(filteredFiles.map((f) => f.relPath)));
    }
    setCopiedBulkCommand(false);
  };

  // Build and copy bulk conversion command
  const copyBulkConversionCommand = () => {
    const selectedFiles = filteredFiles.filter((f) => selectedForConversion.has(f.relPath));
    if (selectedFiles.length === 0) return;

    // Build individual commands for each file
    const commands = selectedFiles.map((file) => buildConvertCommand(file, mediaRoot));

    // Join with && to run sequentially (stops on error)
    const bulkCommand = commands.join(" && ");

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(bulkCommand)
        .then(() => setCopiedBulkCommand(true))
        .catch(() => setCopiedBulkCommand(false));
    } else {
      setCopiedBulkCommand(false);
      window.prompt("Copy this bulk command", bulkCommand);
    }
  };

  // Load available media list
  useEffect(() => {
    let cancelled = false;
    setFiles([]);
    setLoading(true);
    setMessage(null);
    setError(null);
    setManifestUpdatedAt(null);

    const load = async () => {
      try {
        let filesJson: { items?: MediaFile[]; generatedAt?: string } = {};
        let generatedAt: string | null = null;
        if (mediaSource === "remote") {
          try {
            const manifestRes = await fetch(
              `/api/media-index?base=${encodeURIComponent(REMOTE_MEDIA_BASE)}&t=${Date.now()}`,
              { cache: "no-store" },
            );
            if (!manifestRes.ok) {
              const text = await manifestRes.text();
              throw new Error(text);
            }
            filesJson = await manifestRes.json();
            generatedAt = filesJson.generatedAt ?? null;
          } catch (err) {
            console.warn("Remote manifest fetch failed", err);
            throw new Error("Failed to load remote media index");
          }
        } else {
          const filesRes = await fetch(
            `/api/media-files?t=${Date.now()}`,
            { cache: "no-store" },
          );
          filesJson = await filesRes.json();
        }

        if (!cancelled) {
          setFiles(filesJson.items || []);
          setManifestUpdatedAt(generatedAt);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load media files");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [mediaSource, mediaRefreshToken]);

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) =>
        a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" }),
      ),
    [files],
  );

  const availableFormats = useMemo(() => {
    const formats = new Set<string>();
    files.forEach((file) => {
      if (file.format) {
        formats.add(file.format.toUpperCase());
      }
    });
    return Array.from(formats).sort();
  }, [files]);

  const availableAudioCodecs = useMemo(() => {
    const codecs = new Set<string>();
    files.forEach((file) => {
      if (file.audioCodec) {
        codecs.add(file.audioCodec.toUpperCase());
      }
    });
    return Array.from(codecs).sort();
  }, [files]);

  const filteredFiles = useMemo(() => {
    const terms = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return sortedFiles.filter((file) => {
      // Format filter
      if (formatFilter !== "all" && (file.format || "").toUpperCase() !== formatFilter) {
        return false;
      }
      // Audio filter
      if (
        audioFilter !== "all" &&
        (file.audioCodec ? file.audioCodec.toUpperCase() : "") !== audioFilter
      ) {
        return false;
      }
      // Support filter
      const browserSupported = isBrowserSupported(file);
      if (supportedFilter === "supported" && !browserSupported) return false;
      if (supportedFilter === "unsupported" && browserSupported) return false;
      // Search query
      if (terms.length > 0) {
        const haystack = `${file.relPath} ${file.title || ""}`.toLowerCase();
        if (!terms.every((term) => haystack.includes(term))) {
          return false;
        }
      }
      return true;
    });
  }, [sortedFiles, formatFilter, audioFilter, supportedFilter, searchQuery]);

  const totalDurationSeconds = useMemo(
    () => sortedFiles.reduce((sum, f) => sum + (f.durationSeconds || 0), 0),
    [sortedFiles],
  );

  const refreshMediaList = () => {
    setMediaRefreshToken((token) => token + 1);
  };

  const scanRemoteMedia = async () => {
    setScanningRemote(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/media-index/scan-remote", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Scan failed");
      }
      
      // Show scan report modal if we have detailed results
      if (data.fileResults && data.stats) {
        setScanReport({
          fileResults: data.fileResults,
          stats: data.stats,
          message: data.message || `Scanned ${data.count} files`,
        });
      } else {
        setMessage(data.message || `Scanned remote and found ${data.count} files`);
      }
      
      refreshMediaList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanningRemote(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">
            Media Library
          </p>
          <p className="text-sm text-neutral-400">
            Single source of truth for all media files based on current source settings ({mediaSource === "remote" ? "Remote CDN" : "Local files"}).
          </p>
          {manifestUpdatedAt && (
            <p className="text-xs text-neutral-500 mt-1">
              Media index JSON updated {formatDateTime(manifestUpdatedAt)}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold flex-shrink-0 ${
            mediaSource === "remote"
              ? "bg-blue-500/20 text-blue-200"
              : "bg-emerald-500/20 text-emerald-200"
          }`}
        >
          {mediaSource === "remote" ? "Remote" : "Local"}
        </span>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Total Files</p>
          <p className="text-2xl font-semibold text-neutral-50">{sortedFiles.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Supported</p>
          <p className="text-2xl font-semibold text-emerald-300">
            {sortedFiles.filter((f) => isBrowserSupported(f)).length}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Total Duration</p>
          <p className="text-2xl font-semibold text-neutral-50">
            {formatDuration(totalDurationSeconds)}
          </p>
        </div>
      </div>

      {/* Media Table */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-neutral-100">
              Available Media
            </h3>
            <span className="text-xs text-neutral-400">
              {filteredFiles.length} file{filteredFiles.length === 1 ? "" : "s"}
              {filteredFiles.length !== sortedFiles.length &&
                ` (of ${sortedFiles.length} total)`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {aiConfiguredGlobal && !bulkAiRunning && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={bulkAiSupportedOnly}
                    onChange={(e) => setBulkAiSupportedOnly(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
                  />
                  Supported only
                </label>
                <div className="relative group">
                  <button
                    onClick={() => handleBulkAiFill(true)}
                    disabled={loading || filteredFiles.length === 0}
                    className="flex items-center gap-1.5 rounded-md border border-blue-300/50 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                    title="Use AI to fill metadata for files without titles"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Fill Empty with AI
                  </button>
                  {/* Dropdown for "Fill All" option */}
                  <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-10">
                    <button
                      onClick={() => handleBulkAiFill(false)}
                      disabled={loading || filteredFiles.length === 0}
                      className="whitespace-nowrap rounded-md border border-amber-300/50 bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-50 transition hover:border-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
                      title="Re-fill ALL visible files with AI (overwrites existing)"
                    >
                      Fill All (overwrite)
                    </button>
                  </div>
                </div>
              </div>
            )}
            {bulkAiRunning && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-blue-300">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>
                    {bulkAiProgress.current}/{bulkAiProgress.total}
                  </span>
                </div>
                <div className="max-w-[200px] truncate text-xs text-neutral-400" title={bulkAiProgress.currentFile}>
                  {bulkAiProgress.currentFile.split("/").pop()}
                </div>
                <button
                  onClick={cancelBulkAiFill}
                  className="rounded-md border border-red-300/50 bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-50 transition hover:border-red-200 hover:bg-red-500/30"
                >
                  Cancel
                </button>
              </div>
            )}
            {!bulkAiRunning && (
              <button
                onClick={refreshMediaList}
                disabled={loading}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                title="Refresh the media library"
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            )}
            {mediaSource === "remote" && (
              <button
                onClick={() => void scanRemoteMedia()}
                disabled={loading || scanningRemote}
                className="rounded-md border border-blue-300/50 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                title="Scan remote FTP folder, analyze all media files, and update the remote media-index.json"
              >
                {scanningRemote ? "Syncing…" : "Scan & Sync Remote"}
              </button>
            )}
          </div>
        </div>

        {/* Bulk Conversion Command Button */}
        {selectedForConversion.size > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-emerald-200">
                {selectedForConversion.size} file{selectedForConversion.size === 1 ? "" : "s"} selected
              </span>
              <button
                onClick={copyBulkConversionCommand}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30"
              >
                {copiedBulkCommand ? "Copied!" : "Copy conversion command"}
              </button>
            </div>
            <button
              onClick={() => {
                setSelectedForConversion(new Set());
                setCopiedBulkCommand(false);
              }}
              className="text-xs text-neutral-400 hover:text-neutral-200 transition"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Filters and Search */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by filename..."
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Format</label>
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100"
            >
              <option value="all">All</option>
              {availableFormats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Audio</label>
            <select
              value={audioFilter}
              onChange={(e) => setAudioFilter(e.target.value)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100"
            >
              <option value="all">All</option>
              {availableAudioCodecs.map((codec) => (
                <option key={codec} value={codec}>
                  {codec}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Supported</label>
            <select
              value={supportedFilter}
              onChange={(e) => setSupportedFilter(e.target.value as typeof supportedFilter)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100"
            >
              <option value="all">All</option>
              <option value="supported">Supported</option>
              <option value="unsupported">Unsupported</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-300">Loading…</p>
        ) : (
          <>
            {sortedFiles.length === 0 ? (
              <p className="text-sm text-neutral-300">
                No media found in your library. Add files to your media folder.
              </p>
            ) : filteredFiles.length === 0 ? (
              <p className="text-sm text-neutral-300">
                No media files match the current filters.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/5">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-white/5 text-neutral-200">
                    <tr>
                      <th className="px-3 py-2 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={selectedForConversion.size === filteredFiles.length && filteredFiles.length > 0}
                          onChange={toggleAllVisible}
                          className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                          title="Select/deselect all visible files"
                        />
                      </th>
                      <th className="px-3 py-2 font-semibold">File</th>
                      <th className="px-3 py-2 font-semibold min-w-[150px]">Title</th>
                      <th className="px-3 py-2 font-semibold w-16 text-center">Year</th>
                      <th className="px-3 py-2 font-semibold min-w-[120px]">Director</th>
                      <th className="px-3 py-2 font-semibold min-w-[100px]">Category</th>
                      <th className="px-3 py-2 font-semibold w-20 text-left">
                        Format
                      </th>
                      <th className="px-3 py-2 font-semibold w-20 text-left">
                        Audio
                      </th>
                      <th className="px-3 py-2 font-semibold w-28 text-left">
                        Supported
                      </th>
                      <th className="px-3 py-2 font-semibold w-24 text-right">
                        Duration
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 bg-neutral-950/40 text-neutral-100">
                    {filteredFiles.map((file) => {
                      const meta = allMetadata[file.relPath] || {};
                      const isSelected = selectedForConversion.has(file.relPath);
                      return (
                        <tr key={file.relPath} className={isSelected ? "bg-emerald-500/5" : ""}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleFileSelection(file.relPath)}
                              className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-left underline decoration-dotted underline-offset-2 hover:text-emerald-200"
                              onClick={() => setSelectedFile(file)}
                            >
                              {file.relPath}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-neutral-200">
                            {meta.title || <span className="text-neutral-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center text-neutral-200">
                            {meta.year || <span className="text-neutral-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-neutral-200">
                            {meta.director || <span className="text-neutral-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-neutral-200">
                            {meta.category || <span className="text-neutral-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-left text-neutral-200 uppercase">
                            {file.format || "—"}
                          </td>
                          <td className="px-3 py-2 text-left text-neutral-200 uppercase">
                            {file.audioCodec || "—"}
                          </td>
                          <td className="px-3 py-2 text-left">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                isBrowserSupported(file)
                                  ? "bg-emerald-500/20 text-emerald-100"
                                  : "bg-amber-500/20 text-amber-100"
                              }`}
                            >
                              {isBrowserSupported(file)
                                ? file.supportedViaCompanion
                                  ? "Yes (companion)"
                                  : "Yes"
                                : hasUnsupportedAudio(file)
                                  ? "No (audio)"
                                  : "No"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-neutral-200">
                            {formatDuration(file.durationSeconds)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-amber-300">{error}</p>}

      {selectedFile && (
        <MediaDetailModal
          item={selectedFile}
          mediaSource={mediaSource}
          mediaRoot={mediaRoot}
          onClose={() => setSelectedFile(null)}
          onMetadataUpdate={(relPath, metadata) => {
            setAllMetadata((prev) => ({
              ...prev,
              [relPath]: metadata,
            }));
          }}
        />
      )}

      {scanReport && (
        <ScanReportModal
          report={scanReport}
          onClose={() => setScanReport(null)}
        />
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  }
  return `${minutes}m`;
}

function formatDateTime(value: string): string {
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

// Audio codecs that browsers can't play natively
const UNSUPPORTED_AUDIO_CODECS = ["ac3", "eac3", "dts", "truehd", "dts-hd", "dtshd", "pcm_s16le", "pcm_s24le", "pcm_s32le", "flac"];

function hasUnsupportedAudio(file: MediaFile): boolean {
  if (!file.audioCodec) return false;
  const codec = file.audioCodec.toLowerCase();
  return UNSUPPORTED_AUDIO_CODECS.some(unsupported => codec.includes(unsupported));
}

function isBrowserSupported(file: MediaFile): boolean {
  if (hasUnsupportedAudio(file)) return false;
  return file.supported || file.supportedViaCompanion;
}

function isAlreadyOptimal(file: MediaFile): boolean {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  // Optimal format: MP4 with H.264 video and AAC audio
  if (ext !== "mp4" && ext !== "m4v") return false;
  if (hasUnsupportedAudio(file)) return false;
  if (needsFullReencode(file)) return false;
  // Check if audio is already AAC
  const audioCodec = file.audioCodec?.toLowerCase() || "";
  if (audioCodec && audioCodec !== "aac") return false;
  return file.supported && !file.supportedViaCompanion;
}

function needsFullReencode(file: MediaFile): boolean {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const filename = file.relPath.toLowerCase();
  
  const fullReencodeExtensions = ["avi", "wmv", "asf", "flv", "mpeg", "mpg", "vob", "ogv", "ogg", "3gp", "3g2"];
  
  const isH264 = filename.includes("x264") || 
                 filename.includes("h264") || 
                 filename.includes("h.264") ||
                 filename.includes("avc");
  
  if (ext === "avi" && isH264) return false;
  if (fullReencodeExtensions.includes(ext)) return true;
  
  const isHevc = file.format?.toLowerCase()?.includes("hevc") || 
                 file.format?.toLowerCase()?.includes("x265") ||
                 filename.includes("x265") ||
                 filename.includes("hevc") ||
                 filename.includes("h265") ||
                 filename.includes("h.265");
  
  return isHevc;
}

function needsAudioOnlyConversion(file: MediaFile): boolean {
  // Check if it's a compatible container with just bad audio
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const compatibleContainers = ["mp4", "m4v", "mov"];
  if (!compatibleContainers.includes(ext)) return false;
  if (needsFullReencode(file)) return false;
  return hasUnsupportedAudio(file);
}

function getConversionDescription(file: MediaFile): string {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const filename = file.relPath.toLowerCase();
  
  const isH264 = filename.includes("x264") || 
                 filename.includes("h264") || 
                 filename.includes("h.264") ||
                 filename.includes("avc");
  
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

function copyConvertCommand(
  file: MediaFile,
  mediaRoot: string,
  setCopied: (value: boolean) => void,
) {
  const cmd = buildConvertCommand(file, mediaRoot);
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

function buildConvertCommand(file: MediaFile, mediaRoot: string): string {
  const escapedIn = escapeDoubleQuotes(file.relPath);
  const base = file.relPath.replace(/\.[^/.]+$/, "");
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  
  // Determine output filename suffix based on conversion type
  let outName: string;
  if (ext === "mp4" || ext === "m4v") {
    if (needsFullReencode(file)) {
      outName = `${base}_h264.mp4`;  // Re-encoded from HEVC to H.264
    } else if (isAlreadyOptimal(file)) {
      outName = `${base}_optimized.mp4`;  // Already optimal, just adding faststart
    } else {
      outName = `${base}_aac.mp4`;   // Audio-only conversion
    }
  } else {
    outName = `${base}.mp4`;
  }
  const escapedOut = escapeDoubleQuotes(outName);
  const escapedRoot = escapeDoubleQuotes(mediaRoot);
  const inputPath = `"${escapedRoot}/${escapedIn}"`;
  const outputPath = `"${escapedRoot}/${escapedOut}"`;
  
  // -n flag prevents overwriting existing files (never prompts, just exits if file exists)
  
  // Already optimal files - just copy with faststart for streaming optimization
  if (isAlreadyOptimal(file)) {
    return `ffmpeg -n -i ${inputPath} -c:v copy -c:a copy -movflags +faststart ${outputPath}`;
  }
  
  switch (ext) {
    case "avi":
      if (file.relPath.toLowerCase().includes("x264") || 
          file.relPath.toLowerCase().includes("h264") ||
          file.relPath.toLowerCase().includes("h.264")) {
        return `ffmpeg -n -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "wmv":
    case "asf":
      return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "flv":
      return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mov":
      if (needsFullReencode(file)) {
        return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      return `ffmpeg -n -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mkv":
      if (needsFullReencode(file)) {
        return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      return `ffmpeg -n -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mpeg":
    case "mpg":
    case "vob":
      return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "ts":
    case "m2ts":
    case "mts":
      return `ffmpeg -n -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "webm":
      return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "ogv":
    case "ogg":
      return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "3gp":
    case "3g2":
      return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mp4":
    case "m4v":
      if (needsFullReencode(file)) {
        return `ffmpeg -n -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      return `ffmpeg -n -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    default:
      return `ffmpeg -n -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
  }
}

function escapeDoubleQuotes(value: string): string {
  return value.replace(/(["\\`$])/g, "\\$1");
}

