"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";
import { cleanupFilename } from "@/lib/filename-utils";

type MediaFile = {
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

type TargetResolution = "original" | "720";

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
  dateAdded?: string | null;
  lastUpdated?: string | null;
  coverUrl?: string | null;
  coverLocal?: string | null;
  coverPath?: string | null; // Full filesystem path for local mode
  tags?: string[] | null; // Flexible tags for actors, themes, keywords, etc.
};

type CoverOption = {
  filename: string;
  url: string;
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
  // Incremental scan stats
  unchangedCount?: number;
  newOrChangedCount?: number;
  skippedFailureCount?: number;
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
  allFiles,
  onClose,
  onMetadataUpdate,
  onFileRenamed,
}: {
  item: MediaFile;
  mediaSource: MediaSource;
  mediaRoot: string;
  allFiles: MediaFile[];
  onClose: () => void;
  onMetadataUpdate?: (relPath: string, metadata: MediaMetadata) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
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
  
  // Resolution conversion state
  const [targetResolution, setTargetResolution] = useState<TargetResolution>("original");

  // Reset conversion state when item changes
  useEffect(() => {
    setTargetResolution("original");
    setCopiedCommand(false);
  }, [item.relPath]);

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
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState<string>("");
  const [availableCovers, setAvailableCovers] = useState<CoverOption[]>([]);
  
  // AI lookup state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiTokenLevel, setAiTokenLevel] = useState<"fast" | "balanced" | "detailed">("balanced");
  const [aiContextEnabled, setAiContextEnabled] = useState(false);
  const [aiContextText, setAiContextText] = useState("");

  // Filename rename state
  const [showRenameUI, setShowRenameUI] = useState(false);
  const [proposedFilename, setProposedFilename] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSuccess, setRenameSuccess] = useState(false);
  const [renameResult, setRenameResult] = useState<{
    scheduleUpdated?: boolean;
    metadataUpdated?: boolean;
    updatedChannels?: string[];
  } | null>(null);
  const [currentRelPath, setCurrentRelPath] = useState(item.relPath);

  // Faststart status state
  const [faststartStatus, setFaststartStatus] = useState<{
    checked: boolean;
    hasFaststart: boolean | null;
    moovPosition: "start" | "end" | "unknown";
    loading: boolean;
    error?: string;
  }>({ checked: false, hasFaststart: null, moovPosition: "unknown", loading: false });

  // Compute if filename needs cleanup
  const cleanedPath = useMemo(() => cleanupFilename(currentRelPath), [currentRelPath]);
  const filenameNeedsCleanup = currentRelPath !== cleanedPath;

  // Check for supported versions in the same folder (for unsupported files)
  const supportedVersions = useMemo(() => {
    // Only compute if this file is unsupported
    if (isBrowserSupported(item)) return [];
    
    // Get the folder path and base name (without extension)
    const lastSlash = currentRelPath.lastIndexOf("/");
    const folder = lastSlash >= 0 ? currentRelPath.substring(0, lastSlash) : "";
    const filename = lastSlash >= 0 ? currentRelPath.substring(lastSlash + 1) : currentRelPath;
    const lastDot = filename.lastIndexOf(".");
    const baseName = lastDot >= 0 ? filename.substring(0, lastDot).toLowerCase() : filename.toLowerCase();
    
    // Find other files in the same folder with matching base name
    return allFiles.filter((f) => {
      if (f.relPath === currentRelPath) return false; // Skip self
      
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
  }, [item, currentRelPath, allFiles]);

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

    // Fetch both metadata and available covers in parallel
    Promise.all([
      fetch(`/api/media-metadata?file=${encodeURIComponent(item.relPath)}&source=${mediaSource}`).then((res) => res.json()),
      fetch(`/api/covers?source=${mediaSource}`).then((res) => res.json()),
    ])
      .then(([metaData, coversData]) => {
        if (!cancelled) {
          if (metaData.metadata) {
            setMetadata(metaData.metadata);
            setEditTitle(metaData.metadata.title ?? "");
            setEditYear(metaData.metadata.year?.toString() ?? "");
            setEditDirector(metaData.metadata.director ?? "");
            setEditCategory(metaData.metadata.category ?? "");
            setEditMakingOf(metaData.metadata.makingOf ?? "");
            setEditPlot(metaData.metadata.plot ?? "");
            setEditType(metaData.metadata.type ?? "");
            setEditSeason(metaData.metadata.season?.toString() ?? "");
            setEditEpisode(metaData.metadata.episode?.toString() ?? "");
            setEditTags(metaData.metadata.tags ?? []);
          }
          if (coversData.covers) {
            setAvailableCovers(coversData.covers);
          }
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

  // Check faststart status for MP4/M4V/MOV files
  useEffect(() => {
    const ext = item.relPath.toLowerCase().split(".").pop();
    const isMP4Like = ext === "mp4" || ext === "m4v" || ext === "mov";
    
    if (!isMP4Like) {
      setFaststartStatus({ checked: true, hasFaststart: null, moovPosition: "unknown", loading: false });
      return;
    }
    
    setFaststartStatus(prev => ({ ...prev, loading: true, checked: false }));
    
    fetch(`/api/media-index/faststart?source=${mediaSource}&file=${encodeURIComponent(item.relPath)}`)
      .then(res => res.json())
      .then(data => {
        const result = data.results?.[0];
        if (result) {
          setFaststartStatus({
            checked: true,
            hasFaststart: result.hasFaststart,
            moovPosition: result.moovPosition || "unknown",
            loading: false,
            error: result.error,
          });
        } else {
          setFaststartStatus({
            checked: true,
            hasFaststart: null,
            moovPosition: "unknown",
            loading: false,
            error: data.error,
          });
        }
      })
      .catch(err => {
        setFaststartStatus({
          checked: true,
          hasFaststart: null,
          moovPosition: "unknown",
          loading: false,
          error: err.message || "Failed to check faststart",
        });
      });
  }, [item.relPath, mediaSource]);

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
          userContext: aiContextEnabled && aiContextText.trim() ? aiContextText.trim() : undefined,
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
          source: mediaSource,
          title: editTitle.trim() || null,
          year: editYear ? parseInt(editYear, 10) : null,
          director: editDirector.trim() || null,
          category: editCategory.trim() || null,
          makingOf: editMakingOf.trim() || null,
          plot: editPlot.trim() || null,
          type: editType || null,
          season: editSeason ? parseInt(editSeason, 10) : null,
          episode: editEpisode ? parseInt(editEpisode, 10) : null,
          tags: editTags.length > 0 ? editTags : null,
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
    setEditTags(metadata.tags ?? []);
    setNewTagInput("");
    setEditingMetadata(false);
    setMetadataError(null);
  };

  const handleMetadataKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !metadataSaving) {
      e.preventDefault();
      handleSaveMetadata();
    }
  };

  // Filename rename handlers
  const handleShowRename = () => {
    setShowRenameUI(true);
    setProposedFilename(cleanedPath);
    setRenameError(null);
    setRenameSuccess(false);
    setRenameResult(null);
  };

  const handleCancelRename = () => {
    setShowRenameUI(false);
    setProposedFilename("");
    setRenameError(null);
  };

  const handleConfirmRename = async () => {
    if (!proposedFilename || proposedFilename === currentRelPath) {
      setRenameError("New filename must be different");
      return;
    }

    setRenameLoading(true);
    setRenameError(null);

    try {
      const res = await fetch("/api/media-files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldPath: currentRelPath,
          newPath: proposedFilename,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Rename failed");
      }

      // Success - update local state
      setCurrentRelPath(proposedFilename);
      setShowRenameUI(false);
      setRenameSuccess(true);
      setRenameResult({
        scheduleUpdated: data.scheduleUpdated,
        metadataUpdated: data.metadataUpdated,
        updatedChannels: data.updatedChannels,
      });
      
      // Notify parent to refresh media list
      onFileRenamed?.(currentRelPath, proposedFilename);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenameLoading(false);
    }
  };

  // Build the video URL based on media source
  const videoUrl =
    mediaSource === "remote"
      ? `${REMOTE_MEDIA_BASE}${currentRelPath}`
      : `/api/media?file=${encodeURIComponent(currentRelPath)}`;

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

  const fileName = currentRelPath.split("/").pop() || currentRelPath;
  const fullPath = mediaSource === "remote" 
    ? `${REMOTE_MEDIA_BASE}${currentRelPath}`
    : `${mediaRoot}/${currentRelPath}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
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
            <div className="mt-1 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-neutral-500 font-medium">Relative Path:</span>
                <p className="text-xs text-neutral-400 truncate font-mono flex-1" title={currentRelPath}>
                  {currentRelPath}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-neutral-500 font-medium">Full Path:</span>
                <p className="text-xs text-neutral-400 truncate font-mono flex-1" title={fullPath}>
                  {fullPath}
                </p>
              </div>
            </div>
            {renameSuccess && (
              <div className="text-xs text-emerald-400 mt-1">
                <p>File renamed successfully</p>
                {renameResult && (
                  <p className="text-emerald-500/80 mt-0.5">
                    {[
                      renameResult.scheduleUpdated && renameResult.updatedChannels?.length
                        ? `Updated ${renameResult.updatedChannels.length} channel${renameResult.updatedChannels.length !== 1 ? "s" : ""}: ${renameResult.updatedChannels.join(", ")}`
                        : null,
                      renameResult.metadataUpdated ? "Metadata preserved" : null,
                    ].filter(Boolean).join(" • ") || "No schedule references found"}
                  </p>
                )}
              </div>
            )}
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
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
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
            <div>
              <p className="text-xs text-neutral-500 mb-1">Health</p>
              <MediaHealthBadge file={item} />
            </div>
          </div>

          {/* Faststart Status - show for MP4/M4V/MOV files */}
          {(() => {
            const ext = item.relPath.toLowerCase().split(".").pop();
            const isMP4Like = ext === "mp4" || ext === "m4v" || ext === "mov";
            if (!isMP4Like) return null;
            
            return (
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="flex items-center gap-3">
                  <p className="text-xs text-neutral-500">Stream Optimization:</p>
                  {faststartStatus.loading ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-400/30 bg-neutral-500/20 px-2 py-0.5 text-xs font-medium text-neutral-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-pulse" />
                      Checking...
                    </span>
                  ) : faststartStatus.hasFaststart === true ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Optimized (faststart)
                    </span>
                  ) : faststartStatus.hasFaststart === false ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      Needs optimization
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-400/30 bg-neutral-500/20 px-2 py-0.5 text-xs font-medium text-neutral-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" />
                      Unknown
                    </span>
                  )}
                </div>
                {faststartStatus.hasFaststart === false && (
                  <p className="mt-1.5 text-xs text-amber-300/80">
                    moov atom at end of file — viewers joining mid-stream will experience slower load times. 
                    Use the conversion command below to optimize.
                  </p>
                )}
                {faststartStatus.error && (
                  <p className="mt-1 text-xs text-red-400">{faststartStatus.error}</p>
                )}
              </div>
            );
          })()}
          
          {/* Health Details - Show if there are issues */}
          <MediaHealthDetails file={item} />

          {/* Supported version indicator for unsupported files */}
          {!isBrowserSupported(item) && (
            <div className="mt-4 pt-3 border-t border-white/5">
              <p className="text-xs text-neutral-500 mb-1">Supported Version</p>
              {supportedVersions.length > 0 ? (
                <div className="space-y-1">
                  {supportedVersions.map((sv) => {
                    const svFilename = sv.relPath.split("/").pop() || sv.relPath;
                    return (
                      <div key={sv.relPath} className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-200">
                          Available
                        </span>
                        <span className="text-sm text-emerald-300 font-mono truncate" title={sv.relPath}>
                          {svFilename}
                        </span>
                        <span className="text-xs text-neutral-500">
                          ({sv.format.toUpperCase()})
                        </span>
                      </div>
                    );
                  })}
                  <p className="text-xs text-neutral-500 mt-1">
                    A playable version of this file exists in the same folder.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-neutral-500/20 text-neutral-400">
                    Not found
                  </span>
                  <span className="text-xs text-neutral-500">
                    No supported version in this folder
                  </span>
                </div>
              )}
            </div>
          )}

          {item.title && (
            <div className="mt-4 pt-3 border-t border-white/5">
              <p className="text-xs text-neutral-500 mb-1">Title</p>
              <p className="text-sm text-neutral-200">{item.title}</p>
            </div>
          )}

          {/* Conversion Helper - always show for all files */}
          <div className="mt-4 pt-3 border-t border-white/5 space-y-3">
            {/* Resolution Info */}
            {item.videoWidth && item.videoHeight && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-neutral-500">Resolution:</span>
                <span className={`px-2 py-0.5 rounded-full ${
                  item.videoHeight >= 1080 
                    ? "bg-blue-500/20 text-blue-200" 
                    : item.videoHeight >= 720 
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "bg-neutral-500/20 text-neutral-300"
                }`}>
                  {item.videoWidth}×{item.videoHeight}
                  {item.videoHeight >= 1080 ? " (1080p)" : item.videoHeight >= 720 ? " (720p)" : ""}
                </span>
              </div>
            )}
            
            <p className="text-xs text-neutral-400">
              {getConversionDescription(item, targetResolution)}
            </p>
            
            {/* Resolution selector - only show if video is > 720p */}
            {item.videoHeight && item.videoHeight > 720 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">Output:</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setTargetResolution("original");
                      setCopiedCommand(false);
                    }}
                    className={`px-2.5 py-1 text-xs rounded-md transition ${
                      targetResolution === "original"
                        ? "bg-blue-500/30 text-blue-100 border border-blue-400/50"
                        : "bg-white/5 text-neutral-400 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    Keep {item.videoHeight}p
                  </button>
                  <button
                    onClick={() => {
                      setTargetResolution("720");
                      setCopiedCommand(false);
                    }}
                    className={`px-2.5 py-1 text-xs rounded-md transition ${
                      targetResolution === "720"
                        ? "bg-emerald-500/30 text-emerald-100 border border-emerald-400/50"
                        : "bg-white/5 text-neutral-400 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    720p (smaller)
                  </button>
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyConvertCommand(item, mediaRoot, setCopiedCommand, targetResolution)}
                className="rounded-md border border-white/20 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30"
              >
                {copiedCommand ? "Copied!" : "Copy conversion command"}
              </button>
              <span className={`text-xs px-2 py-1 rounded-full ${
                needsSyncFix(item)
                  ? "bg-red-500/20 text-red-200"
                  : targetResolution === "720" && item.videoHeight && item.videoHeight > 720
                  ? "bg-purple-500/20 text-purple-200"
                  : isAlreadyOptimal(item)
                  ? "bg-emerald-500/20 text-emerald-200"
                  : needsFullReencode(item)
                  ? "bg-amber-500/20 text-amber-200"
                  : needsAudioOnlyConversion(item)
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-blue-500/20 text-blue-200"
              }`}>
                {needsSyncFix(item)
                  ? "Sync fix"
                  : targetResolution === "720" && item.videoHeight && item.videoHeight > 720
                  ? "Downscale + re-encode"
                  : isAlreadyOptimal(item) 
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

        {/* Filename Cleanup Section - Only show for remote source */}
        {mediaSource === "remote" && (
          <div className="border-t border-white/10 bg-neutral-800/30 px-5 py-4">
            <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3">Server Filename</h3>
            
            <div className="space-y-3">
              {/* Current filename display */}
              <div>
                <p className="text-xs text-neutral-500 mb-1">Current filename on server</p>
                <p className="text-sm font-mono text-neutral-200 break-all bg-black/20 rounded-lg px-3 py-2">
                  {currentRelPath}
                </p>
              </div>

              {!showRenameUI ? (
                /* Show cleanup button if needed, or rename option if clean */
                <div className="flex items-center gap-3">
                  {filenameNeedsCleanup ? (
                    <>
                      <button
                        onClick={handleShowRename}
                        className="rounded-md border border-amber-300/50 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:border-amber-200 hover:bg-amber-500/30"
                      >
                        Clean up filename
                      </button>
                      <span className="text-xs text-amber-300">
                        Filename has special characters or spaces
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-emerald-300 flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Filename is clean (URL-safe)
                      </span>
                      <button
                        onClick={handleShowRename}
                        className="rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-neutral-400 transition hover:bg-white/10 hover:text-neutral-200"
                      >
                        Rename
                      </button>
                    </>
                  )}
                </div>
              ) : (
                /* Rename UI */
                <div className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-4">
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Proposed new filename</label>
                    <input
                      type="text"
                      value={proposedFilename}
                      onChange={(e) => setProposedFilename(e.target.value)}
                      className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-mono text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                      placeholder="new-filename.mp4"
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                      You can edit the proposed name before confirming
                    </p>
                  </div>

                  {/* Preview comparison */}
                  {proposedFilename && proposedFilename !== currentRelPath && (
                    <div className="text-xs space-y-1">
                      <p className="text-neutral-500">Preview:</p>
                      <p className="text-red-300/70 line-through font-mono truncate">{currentRelPath}</p>
                      <p className="text-emerald-300 font-mono truncate">{proposedFilename}</p>
                    </div>
                  )}

                  {renameError && (
                    <p className="text-xs text-amber-300">{renameError}</p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleConfirmRename}
                      disabled={renameLoading || !proposedFilename || proposedFilename === currentRelPath}
                      className="rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-neutral-900 transition disabled:opacity-50"
                    >
                      {renameLoading ? "Renaming..." : "Confirm Rename"}
                    </button>
                    <button
                      onClick={handleCancelRename}
                      disabled={renameLoading}
                      className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-neutral-300 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Media Metadata Section */}
        <div className="border-t border-white/10 bg-neutral-800/30 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs uppercase tracking-widest text-neutral-500">Media Metadata</h3>
            {!metadataLoading && (
              <div className="flex items-center gap-3">
                {aiConfigured && (
                  <div className="flex flex-col gap-2">
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
                      <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={aiContextEnabled}
                          onChange={(e) => setAiContextEnabled(e.target.checked)}
                          disabled={aiLoading}
                          className="w-3.5 h-3.5 rounded border-white/15 bg-white/5 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
                        />
                        Add context
                      </label>
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
                    {aiContextEnabled && (
                      <input
                        type="text"
                        value={aiContextText}
                        onChange={(e) => setAiContextText(e.target.value)}
                        disabled={aiLoading}
                        placeholder="e.g. This is a 1980s horror film..."
                        className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-blue-300 disabled:opacity-50"
                      />
                    )}
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
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Tags <span className="text-neutral-600">(actors, themes, keywords)</span></label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {editTags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-200"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => setEditTags(editTags.filter((_, i) => i !== idx))}
                        className="text-emerald-300 hover:text-emerald-100 transition"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newTagInput.trim()) {
                        e.preventDefault();
                        const newTag = newTagInput.trim();
                        if (!editTags.includes(newTag)) {
                          setEditTags([...editTags, newTag]);
                        }
                        setNewTagInput("");
                      }
                    }}
                    placeholder="Add a tag (press Enter)"
                    className="flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newTagInput.trim()) {
                        const newTag = newTagInput.trim();
                        if (!editTags.includes(newTag)) {
                          setEditTags([...editTags, newTag]);
                        }
                        setNewTagInput("");
                      }
                    }}
                    className="rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-300 transition hover:bg-white/10"
                  >
                    Add
                  </button>
                </div>
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
              <div>
                <p className="text-xs text-neutral-500 mb-1">Tags</p>
                {metadata.tags && metadata.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {metadata.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-200"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-neutral-500">—</span>
                )}
              </div>
              
              {/* Last Updated */}
              {metadata.lastUpdated && (
                <div>
                  <p className="text-xs text-neutral-500 mb-1">Last Updated</p>
                  <p className="text-sm text-neutral-400">
                    {new Date(metadata.lastUpdated).toLocaleString()}
                  </p>
                </div>
              )}
              
            </div>
          )}
        </div>

        {/* Dedicated Cover Image Section */}
        <CoverImageSection
          relPath={item.relPath}
          metadata={metadata}
          availableCovers={availableCovers}
          mediaSource={mediaSource}
          onCoverSaved={(updatedMeta) => {
            setMetadata(updatedMeta);
            onMetadataUpdate?.(item.relPath, updatedMeta);
          }}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Cover Image Section Component (for Media Detail Modal)
   ───────────────────────────────────────────────────────────────────────────── */
function CoverImageSection({
  relPath,
  metadata,
  availableCovers,
  mediaSource,
  onCoverSaved,
}: {
  relPath: string;
  metadata: MediaMetadata;
  availableCovers: CoverOption[];
  mediaSource: MediaSource;
  onCoverSaved: (updatedMeta: MediaMetadata) => void;
}) {
  const [coverUrl, setCoverUrl] = useState(metadata.coverUrl || "");
  const [coverLocal, setCoverLocal] = useState(metadata.coverLocal || "");
  const [coverPath, setCoverPath] = useState(metadata.coverPath || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [localCovers, setLocalCovers] = useState<CoverOption[]>(availableCovers);
  
  // Image browser state (for local mode)
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState("");
  const [browserEntries, setBrowserEntries] = useState<{ name: string; path: string; isDirectory: boolean }[]>([]);
  const [browserRoots, setBrowserRoots] = useState<{ name: string; path: string }[]>([]);
  const [browserParent, setBrowserParent] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);

  // Sync state when metadata prop changes
  useEffect(() => {
    setCoverUrl(metadata.coverUrl || "");
    setCoverLocal(metadata.coverLocal || "");
    setCoverPath(metadata.coverPath || "");
  }, [metadata.coverUrl, metadata.coverLocal, metadata.coverPath]);

  // Get the resolved cover URL for preview
  // For remote mode, coverLocal should resolve to remote server URL
  const resolvedCoverUrl = coverUrl 
    || (coverPath && mediaSource === "local" ? `/api/local-image?path=${encodeURIComponent(coverPath)}` : null)
    || (coverLocal ? (mediaSource === "remote" ? `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(coverLocal)}` : `/api/covers/${encodeURIComponent(coverLocal)}`) : null);
  
  const hasChanges = 
    coverUrl !== (metadata.coverUrl || "") || 
    coverLocal !== (metadata.coverLocal || "") ||
    coverPath !== (metadata.coverPath || "");

  // Save cover
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/media-metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: relPath,
          source: mediaSource,
          coverUrl: coverUrl.trim() || null,
          coverLocal: coverLocal || null,
          coverPath: coverPath || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      setSuccess("Cover saved");
      onCoverSaved(data.metadata);
      
      // Clear success message after a moment
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Upload new cover (for remote mode - uploads to FTP)
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source", mediaSource); // Pass source so API knows where to upload

      const res = await fetch("/api/covers", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      // Add to covers list and select it
      setLocalCovers((prev) => {
        const exists = prev.some((c) => c.filename === data.filename);
        if (exists) return prev;
        return [...prev, { filename: data.filename, url: data.url }];
      });
      setCoverLocal(data.filename);
      setCoverUrl("");
      setCoverPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Browse for image (for local mode)
  const openImageBrowser = () => {
    setShowBrowser(true);
    setBrowserError(null);
    void browseTo(coverPath ? coverPath.substring(0, coverPath.lastIndexOf("/")) : "");
  };

  const browseTo = async (targetPath: string) => {
    setBrowserLoading(true);
    setBrowserError(null);

    try {
      const url = targetPath 
        ? `/api/browse?path=${encodeURIComponent(targetPath)}&type=images` 
        : "/api/browse?type=images";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to browse");

      setBrowserPath(data.currentPath || "");
      setBrowserEntries(data.entries || []);
      setBrowserRoots(data.roots || []);
      setBrowserParent(data.parentPath || null);
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : "Failed to browse");
    } finally {
      setBrowserLoading(false);
    }
  };

  const selectImage = (imagePath: string) => {
    setCoverPath(imagePath);
    setCoverUrl("");
    setCoverLocal("");
    setShowBrowser(false);
  };

  // Clear cover
  const handleClear = () => {
    setCoverUrl("");
    setCoverLocal("");
    setCoverPath("");
  };

  const isLocal = mediaSource === "local";

  return (
    <div className="border-t border-white/10 bg-neutral-800/30 px-5 py-4">
      <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3">Cover Image</h3>

      <div className="flex gap-4">
        {/* Cover Preview */}
        <div className="flex-shrink-0">
          <div className="w-28 h-40 rounded-lg border border-white/15 bg-neutral-900 overflow-hidden">
            {resolvedCoverUrl ? (
              <img
                src={resolvedCoverUrl}
                alt="Cover preview"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  (e.target as HTMLImageElement).parentElement!.innerHTML = 
                    '<div class="w-full h-full flex items-center justify-center text-neutral-600 text-xs p-2 text-center">Failed to load</div>';
                }}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-neutral-600 p-2">
                <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs">No cover</span>
              </div>
            )}
          </div>
        </div>

        {/* Cover Controls */}
        <div className="flex-1 space-y-3">
          {isLocal ? (
            /* Local Mode: Browse filesystem for images */
            <>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Local Image File</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={coverPath}
                    onChange={(e) => {
                      setCoverPath(e.target.value);
                      if (e.target.value) {
                        setCoverUrl("");
                        setCoverLocal("");
                      }
                    }}
                    placeholder="/path/to/cover.jpg"
                    className="flex-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300"
                  />
                  <button
                    onClick={openImageBrowser}
                    className="rounded-md border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/10 transition flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    Browse
                  </button>
                </div>
                {coverPath && (
                  <p className="text-xs text-neutral-500 mt-1 truncate" title={coverPath}>
                    {coverPath.split("/").pop()}
                  </p>
                )}
              </div>

              {/* URL input (local mode only) */}
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Or Cover URL</label>
                <input
                  type="url"
                  value={coverUrl}
                  onChange={(e) => {
                    setCoverUrl(e.target.value);
                    if (e.target.value) {
                      setCoverLocal("");
                      setCoverPath("");
                    }
                  }}
                  placeholder="https://example.com/cover.jpg"
                  className="w-full rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300"
                />
              </div>
            </>
          ) : (
            /* Remote Mode: Upload only */
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Upload Cover</label>
              <label className="cursor-pointer rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-neutral-300 hover:bg-white/10 transition flex items-center justify-center gap-2">
                {uploading ? (
                  <span>Uploading...</span>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload Image
                  </>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
              {/* Show resolved URL when a cover is uploaded */}
              {coverLocal && (
                <div className="mt-2 p-2 rounded-md bg-emerald-500/10 border border-emerald-400/30">
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-emerald-300 font-medium mb-1">Cover uploaded</p>
                      <a 
                        href={`${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(coverLocal)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 hover:underline break-all"
                      >
                        {`${REMOTE_MEDIA_BASE}covers/${coverLocal}`}
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status messages */}
          {error && <p className="text-xs text-red-300">{error}</p>}
          {success && <p className="text-xs text-emerald-300">{success}</p>}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-neutral-900 transition disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Cover"}
            </button>
            {(coverUrl || coverLocal || coverPath) && (
              <button
                onClick={handleClear}
                disabled={saving}
                className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-400 hover:bg-white/10 hover:text-neutral-200 transition disabled:opacity-50"
              >
                Clear
              </button>
            )}
            {hasChanges && !saving && (
              <span className="text-xs text-amber-300/70 ml-2">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>

      {/* Image Browser Modal (for local mode) */}
      {showBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowBrowser(false); }}
        >
          <div className="w-full max-w-xl rounded-md border border-white/15 bg-neutral-900 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">Select Cover Image</h3>
                <p className="text-xs text-neutral-400 mt-0.5 font-mono truncate max-w-md">
                  {browserPath || "Select a location"}
                </p>
              </div>
              <button onClick={() => setShowBrowser(false)} className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {browserRoots.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-white/10 px-4 py-2">
                {browserRoots.map((root) => (
                  <button
                    key={root.path}
                    onClick={() => void browseTo(root.path)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                      browserPath === root.path
                        ? "bg-emerald-500/20 text-emerald-100 border border-emerald-400/40"
                        : "bg-white/5 text-neutral-300 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {root.name}
                  </button>
                ))}
              </div>
            )}

            <div className="max-h-80 overflow-y-auto">
              {browserLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 border-2 border-neutral-400 border-t-emerald-400 rounded-full animate-spin" />
                  <span className="ml-2 text-sm text-neutral-400">Loading...</span>
                </div>
              ) : browserError ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-red-400">{browserError}</p>
                  <button onClick={() => void browseTo("")} className="mt-2 text-xs text-neutral-400 hover:text-neutral-200">
                    Back to roots
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {browserParent !== null && (
                    <button onClick={() => void browseTo(browserParent)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5 transition">
                      <svg className="h-5 w-5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                      </svg>
                      <span className="text-sm text-neutral-300">..</span>
                    </button>
                  )}
                  {browserEntries.length === 0 && !browserParent && (
                    <div className="px-4 py-8 text-center text-sm text-neutral-500">No folders or images found.</div>
                  )}
                  {browserEntries.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => entry.isDirectory ? void browseTo(entry.path) : selectImage(entry.path)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5 transition group"
                    >
                      {entry.isDirectory ? (
                        <svg className="h-5 w-5 text-amber-400/70" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                      ) : (
                        <svg className="h-5 w-5 text-blue-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      )}
                      <span className="flex-1 text-sm text-neutral-100 truncate">{entry.name}</span>
                      {entry.isDirectory ? (
                        <svg className="h-4 w-4 text-neutral-600 group-hover:text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      ) : (
                        <span className="text-xs text-emerald-400 opacity-0 group-hover:opacity-100">Select</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
              <p className="text-xs text-neutral-500">
                {browserEntries.filter(e => !e.isDirectory).length} image{browserEntries.filter(e => !e.isDirectory).length !== 1 ? "s" : ""} in folder
              </p>
              <button onClick={() => setShowBrowser(false)} className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Scan Report Modal Component
   ───────────────────────────────────────────────────────────────────────────── */
function ScanReportModal({
  report,
  onClose,
  onRecheck,
  onUpdateReport,
}: {
  report: ScanReport;
  onClose: () => void;
  onRecheck?: (relPath: string) => Promise<{ success: boolean; probeSuccess?: boolean; file?: FileResult; message?: string }>;
  onUpdateReport?: (updatedReport: ScanReport) => void;
}) {
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [recheckingFile, setRecheckingFile] = useState<string | null>(null);
  const { stats, fileResults, message } = report;
  
  // Separate files into categories
  const filesWithIssues = fileResults.filter(f => !f.probeSuccess || f.durationSeconds === 0);
  const filesFixed = fileResults.filter(f => f.wasReprobed && f.probeSuccess && f.durationSeconds > 0);
  const filesOk = fileResults.filter(f => f.probeSuccess && f.durationSeconds > 0);

  // Handle recheck button click
  const handleRecheck = async (relPath: string) => {
    if (!onRecheck || !onUpdateReport) return;
    
    setRecheckingFile(relPath);
    try {
      const result = await onRecheck(relPath);
      
      if (result.success && result.file) {
        // Update the fileResults with the new probe result
        const updatedFileResults = fileResults.map(f => {
          if (f.file === relPath) {
            return {
              ...f,
              durationSeconds: result.file!.durationSeconds,
              probeSuccess: result.file!.probeSuccess,
              probeError: result.file!.probeError,
              wasReprobed: true,
            };
          }
          return f;
        });
        
        // Recalculate stats
        const newStats = {
          ...stats,
          withDuration: updatedFileResults.filter(f => f.durationSeconds > 0).length,
          zeroDuration: updatedFileResults.filter(f => f.durationSeconds === 0).length,
          probeSuccessCount: updatedFileResults.filter(f => f.probeSuccess).length,
          probeFailCount: updatedFileResults.filter(f => !f.probeSuccess).length,
        };
        
        onUpdateReport({
          fileResults: updatedFileResults,
          stats: newStats,
          message: message,
        });
      }
    } catch (err) {
      console.error("Recheck failed:", err);
    } finally {
      setRecheckingFile(null);
    }
  };
  
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
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
            {stats.unchangedCount !== undefined && stats.unchangedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-neutral-500/20 text-neutral-300">
                {stats.unchangedCount} unchanged
              </span>
            )}
            {stats.skippedFailureCount !== undefined && stats.skippedFailureCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-300" title="Files with known probe issues - will retry in 24 hours">
                {stats.skippedFailureCount} skipped (known issues)
              </span>
            )}
            {stats.newOrChangedCount !== undefined && stats.newOrChangedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-300">
                {stats.newOrChangedCount} probed
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
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {onRecheck && (
                        <button
                          onClick={() => handleRecheck(file.file)}
                          disabled={recheckingFile !== null}
                          className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          title="Retry probing this file now"
                        >
                          {recheckingFile === file.file ? (
                            <>
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Checking...
                            </>
                          ) : (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Recheck
                            </>
                          )}
                        </button>
                      )}
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
  // Start with null - wait for localStorage sync before loading data
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);
  const [mediaRefreshToken, setMediaRefreshToken] = useState(0);
  const [scanningRemote, setScanningRemote] = useState(false);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [supportedFilter, setSupportedFilter] = useState<"all" | "supported" | "unsupported" | "needs-conversion">(
    "all",
  );
  const [scheduledFilter, setScheduledFilter] = useState<"all" | "scheduled" | "not-scheduled">("all");
  const [locationFilter, setLocationFilter] = useState<"all" | "in-folder" | "in-root">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"filename" | "title" | "year" | "duration" | "dateAdded">("filename");
  const [manifestUpdatedAt, setManifestUpdatedAt] = useState<string | null>(null);
  const [mediaRoot, setMediaRoot] = useState<string>("media");
  const [allMetadata, setAllMetadata] = useState<Record<string, MediaMetadata>>({});
  
  // Map of file relPath -> array of channel IDs where the file is scheduled
  const [fileChannelMap, setFileChannelMap] = useState<Map<string, string[]>>(new Map());
  
  // Bulk conversion command state
  const [selectedForConversion, setSelectedForConversion] = useState<Set<string>>(new Set());
  const [copiedBulkCommand, setCopiedBulkCommand] = useState(false);

  // Load media source preference from localStorage and stay in sync with other tabs/pages.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncSource = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      // Default to "remote" if not set (matches the source page default)
      const source: MediaSource = stored === "local" ? "local" : "remote";
      setMediaSource(source);
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
    // Wait for mediaSource to be synced from localStorage
    if (mediaSource === null) return;
    
    fetch(`/api/media-metadata?withAutoYear=true&source=${mediaSource}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.items) {
          setAllMetadata(data.items);
        }
      })
      .catch(() => {
        // Ignore errors, metadata is optional
      });
  }, [mediaRefreshToken, mediaSource]);

  // Fetch schedule data to build file->channels map
  useEffect(() => {
    // Wait for mediaSource to be synced from localStorage
    if (mediaSource === null) return;
    
    fetch(`/api/schedule?source=${encodeURIComponent(mediaSource)}&t=${Date.now()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const schedule = data.schedule;
        if (schedule?.channels) {
          const newMap = new Map<string, string[]>();
          
          for (const [chId, chSchedule] of Object.entries(schedule.channels) as [string, { slots?: { file: string }[]; playlist?: { file: string }[] }][]) {
            // Get files from slots (24hour type)
            if (chSchedule.slots) {
              for (const slot of chSchedule.slots) {
                if (slot.file) {
                  const existing = newMap.get(slot.file) || [];
                  if (!existing.includes(chId)) {
                    newMap.set(slot.file, [...existing, chId]);
                  }
                }
              }
            }
            // Get files from playlist (looping type)
            if (chSchedule.playlist) {
              for (const item of chSchedule.playlist) {
                if (item.file) {
                  const existing = newMap.get(item.file) || [];
                  if (!existing.includes(chId)) {
                    newMap.set(item.file, [...existing, chId]);
                  }
                }
              }
            }
          }
          
          setFileChannelMap(newMap);
        }
      })
      .catch(() => {
        // Ignore errors, schedule data is optional for display
      });
  }, [mediaRefreshToken, mediaSource]);

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
    // Wait for mediaSource to be synced from localStorage
    if (mediaSource === null) return;

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

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const metaA = allMetadata[a.relPath] || {};
      const metaB = allMetadata[b.relPath] || {};

      switch (sortBy) {
        case "filename":
          return a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" });
        
        case "title": {
          const titleA = metaA.title || a.relPath;
          const titleB = metaB.title || b.relPath;
          return titleA.localeCompare(titleB, undefined, { sensitivity: "base" });
        }
        
        case "year": {
          const yearA = metaA.year || 0;
          const yearB = metaB.year || 0;
          // Sort descending (newest first)
          return yearB - yearA;
        }
        
        case "duration":
          // Sort descending (longest first)
          return b.durationSeconds - a.durationSeconds;
        
        case "dateAdded": {
          const dateA = metaA.dateAdded || a.dateAdded || "";
          const dateB = metaB.dateAdded || b.dateAdded || "";
          // Sort descending (newest first)
          return dateB.localeCompare(dateA);
        }
        
        default:
          return a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" });
      }
    });
  }, [files, sortBy, allMetadata]);

  const filteredFiles = useMemo(() => {
    const terms = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return sortedFiles.filter((file) => {
      // Support filter
      const browserSupported = isBrowserSupported(file);
      if (supportedFilter === "supported" && !browserSupported) return false;
      if (supportedFilter === "unsupported" && browserSupported) return false;
      if (supportedFilter === "needs-conversion") {
        // Must be unsupported AND have no supported version in same folder
        if (browserSupported) return false;
        const hasSupportedVersion = checkHasSupportedVersion(file, sortedFiles);
        if (hasSupportedVersion) return false;
      }
      // Location filter (in folder vs root)
      if (locationFilter !== "all") {
        const isInFolder = file.relPath.includes("/");
        if (locationFilter === "in-folder" && !isInFolder) return false;
        if (locationFilter === "in-root" && isInFolder) return false;
      }
      // Scheduled filter
      if (scheduledFilter !== "all") {
        const isScheduled = fileChannelMap.has(file.relPath);
        if (scheduledFilter === "scheduled" && !isScheduled) return false;
        if (scheduledFilter === "not-scheduled" && isScheduled) return false;
      }
      // Search query - includes filename, title, and all metadata fields
      if (terms.length > 0) {
        const meta = allMetadata[file.relPath] || {};
        const tagsStr = meta.tags?.join(" ") || "";
        const haystack = [
          file.relPath,
          file.title || "",
          meta.title || "",
          meta.director || "",
          meta.category || "",
          meta.makingOf || "",
          meta.plot || "",
          meta.year?.toString() || "",
          tagsStr,
        ].join(" ").toLowerCase();
        if (!terms.every((term) => haystack.includes(term))) {
          return false;
        }
      }
      return true;
    });
  }, [sortedFiles, supportedFilter, scheduledFilter, locationFilter, searchQuery, allMetadata, fileChannelMap]);

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
          <p className="text-sm uppercase text-neutral-300">
            Media Library
          </p>
          <p className="text-sm text-neutral-400">
            Single source of truth for all media files based on current source settings ({mediaSource === null ? "Loading…" : mediaSource === "remote" ? "Remote CDN" : "Local files"}).
          </p>
          {manifestUpdatedAt && (
            <p className="text-xs text-neutral-500 mt-1">
              Media index JSON updated {formatDateTime(manifestUpdatedAt)}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold flex-shrink-0 ${
            mediaSource === null
              ? "bg-neutral-500/20 text-neutral-200"
              : mediaSource === "remote"
                ? "bg-blue-500/20 text-blue-200"
                : "bg-emerald-500/20 text-emerald-200"
          }`}
        >
          {mediaSource === null ? "…" : mediaSource === "remote" ? "Remote" : "Local"}
        </span>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Total Files</p>
          <p className="text-2xl font-semibold text-neutral-50">{sortedFiles.length}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Supported</p>
          <p className="text-2xl font-semibold text-emerald-300">
            {sortedFiles.filter((f) => isBrowserSupported(f)).length}
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Total Duration</p>
          <p className="text-2xl font-semibold text-neutral-50">
            {formatDuration(totalDurationSeconds)}
          </p>
        </div>
      </div>

      {/* Media Table */}
      <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
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
            <button
              onClick={refreshMediaList}
              disabled={loading}
              className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              title="Refresh the media library"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {mediaSource === "remote" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void scanRemoteMedia()}
                  disabled={loading || scanningRemote}
                  className="rounded-md border border-blue-300/50 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                  title="Scan remote FTP folder, analyze all media files, and update the remote media-index.json"
                >
                  {scanningRemote ? "Syncing…" : "Scan & Sync Remote"}
                </button>
              </div>
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
              placeholder="Search files, tags, actors, plot..."
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Sort by</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100"
            >
              <option value="filename">Filename</option>
              <option value="title">Title</option>
              <option value="year">Year</option>
              <option value="duration">Duration</option>
              <option value="dateAdded">Date Added</option>
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
              <option value="needs-conversion">Needs conversion</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Scheduled</label>
            <select
              value={scheduledFilter}
              onChange={(e) => setScheduledFilter(e.target.value as typeof scheduledFilter)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100"
            >
              <option value="all">All</option>
              <option value="scheduled">Scheduled</option>
              <option value="not-scheduled">Not scheduled</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Location</label>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value as typeof locationFilter)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100"
            >
              <option value="all">All</option>
              <option value="in-folder">In folder</option>
              <option value="in-root">In root</option>
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
                      <th className="px-3 py-2 font-semibold w-16 text-center">Cover</th>
                      <th className="px-3 py-2 font-semibold w-64">File</th>
                      <th className="px-3 py-2 font-semibold w-20 text-left">
                        Format
                      </th>
                      <th className="px-3 py-2 font-semibold w-28 text-left">
                        Supported
                      </th>
                      <th className="px-3 py-2 font-semibold w-28 text-left">
                        Scheduled
                      </th>
                      <th className="px-3 py-2 font-semibold min-w-[150px]">Title</th>
                      <th className="px-3 py-2 font-semibold w-16 text-center">Year</th>
                      <th className="px-3 py-2 font-semibold min-w-[120px]">Tags</th>
                      <th className="px-3 py-2 font-semibold w-24 text-right">
                        Duration
                      </th>
                      <th className="px-3 py-2 font-semibold w-28 text-left">
                        Added
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 bg-neutral-950/40 text-neutral-100">
                    {filteredFiles.map((file) => {
                      const meta = allMetadata[file.relPath] || {};
                      const isSelected = selectedForConversion.has(file.relPath);
                      // Resolve cover URL - for remote mode, coverLocal should point to remote server
                      const resolvedCoverUrl = meta.coverUrl 
                        || (meta.coverPath && mediaSource === "local" ? `/api/local-image?path=${encodeURIComponent(meta.coverPath)}` : null)
                        || (meta.coverLocal ? (mediaSource === "remote" ? `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(meta.coverLocal)}` : `/api/covers/${encodeURIComponent(meta.coverLocal)}`) : null);
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
                            {resolvedCoverUrl ? (
                              <img 
                                src={resolvedCoverUrl} 
                                alt={meta.title || file.relPath}
                                className="w-12 h-12 object-cover rounded border border-white/10"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedFile(file)}
                                className="w-12 h-12 bg-white/5 rounded border border-white/10 flex items-center justify-center text-neutral-600 hover:text-neutral-400 hover:bg-white/10 text-xs transition-colors cursor-pointer"
                                title="Click to add cover"
                              >
                                —
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2 max-w-[256px]">
                            <button
                              type="button"
                              className="text-left underline decoration-dotted underline-offset-2 hover:text-emerald-200 truncate block w-full"
                              onClick={() => setSelectedFile(file)}
                              title={file.relPath}
                            >
                              {file.relPath}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-left text-neutral-200 uppercase">
                            {file.format || "—"}
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
                          <td className="px-3 py-2 text-left">
                            {(() => {
                              const scheduledChannels = fileChannelMap.get(file.relPath) || [];
                              if (scheduledChannels.length === 0) {
                                return <span className="text-xs text-neutral-500">—</span>;
                              }
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {scheduledChannels.map((ch) => (
                                    <span
                                      key={ch}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-500/30 text-purple-200 border border-purple-400/40"
                                      title={`Scheduled in channel ${ch}`}
                                    >
                                      {ch}
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-neutral-200">
                            {meta.title || <span className="text-neutral-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center text-neutral-200">
                            {meta.year || <span className="text-neutral-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-neutral-200">
                            {meta.tags && meta.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {meta.tags.map((tag, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-block px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-200 border border-blue-400/20"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-neutral-500">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-neutral-200">
                            {formatDuration(file.durationSeconds)}
                          </td>
                          <td className="px-3 py-2 text-left text-neutral-400 text-xs">
                            {file.dateAdded ? formatDateAdded(file.dateAdded) : "—"}
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

      {selectedFile && mediaSource && (
        <MediaDetailModal
          item={selectedFile}
          mediaSource={mediaSource}
          mediaRoot={mediaRoot}
          allFiles={files}
          onClose={() => setSelectedFile(null)}
          onMetadataUpdate={(relPath, metadata) => {
            setAllMetadata((prev) => ({
              ...prev,
              [relPath]: metadata,
            }));
          }}
          onFileRenamed={(oldPath, newPath) => {
            // Update the files list with the new path and title
            const newFileName = newPath.split("/").pop() || newPath;
            const newTitle = newFileName.replace(/\.[^/.]+$/, "");
            setFiles((prev) =>
              prev.map((f) =>
                f.relPath === oldPath 
                  ? { ...f, relPath: newPath, title: newTitle } 
                  : f
              )
            );
            // Update the selected file
            setSelectedFile((prev) =>
              prev && prev.relPath === oldPath 
                ? { ...prev, relPath: newPath, title: newTitle } 
                : prev
            );
            // Move metadata to new key
            setAllMetadata((prev) => {
              const updated = { ...prev };
              if (updated[oldPath]) {
                updated[newPath] = updated[oldPath];
                delete updated[oldPath];
              }
              return updated;
            });
            setMessage(`File renamed successfully`);
          }}
        />
      )}

      {scanReport && (
        <ScanReportModal
          report={scanReport}
          onClose={() => setScanReport(null)}
          onRecheck={async (relPath) => {
            const res = await fetch("/api/media-index/recheck", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ relPath }),
            });
            const data = await res.json();
            if (data.success && data.probeSuccess) {
              // Refresh the media list since the index was updated
              refreshMediaList();
            }
            return {
              success: data.success,
              probeSuccess: data.probeSuccess,
              file: data.file,
              message: data.message,
            };
          }}
          onUpdateReport={(updatedReport) => setScanReport(updatedReport)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Media Health Components
   ───────────────────────────────────────────────────────────────────────────── */

function MediaHealthBadge({ file }: { file: MediaFile }) {
  const health = computeMediaHealth(file);
  const status = getMediaHealthStatusLabel(health);
  
  const colorClasses = {
    green: "bg-emerald-500/20 text-emerald-200",
    yellow: "bg-amber-500/20 text-amber-200",
    red: "bg-red-500/20 text-red-200",
  };
  
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colorClasses[status.color]}`}
      title={status.label}
    >
      {status.shortLabel}
    </span>
  );
}

function MediaHealthDetails({ file }: { file: MediaFile }) {
  const health = computeMediaHealth(file);
  
  if (health.isHealthy) {
    return null;
  }
  
  return (
    <div className="mt-4 pt-3 border-t border-white/5">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <p className="text-xs font-semibold text-amber-200 mb-2 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Media Health Issues Detected
        </p>
        <ul className="space-y-1.5 text-xs text-amber-100/80">
          {health.issues.map((issue, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="text-amber-300 mt-0.5">•</span>
              <span>{getMediaHealthIssueDescription(issue)}</span>
            </li>
          ))}
        </ul>
        {health.avgFps && (
          <p className="mt-2 text-xs text-neutral-400">
            Frame rate: {health.avgFps.toFixed(2)} fps
            {file.frameRateMode && ` (${file.frameRateMode.toUpperCase()})`}
          </p>
        )}
        <p className="mt-2 text-xs text-amber-200/60">
          Re-encoding with the conversion command below will fix these issues.
        </p>
      </div>
    </div>
  );
}

function computeMediaHealth(file: MediaFile): MediaHealthStatus {
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

type MediaHealthStatus = {
  isHealthy: boolean;
  issues: MediaHealthIssue[];
  frameRateMode?: "cfr" | "vfr" | "unknown";
  avgFps?: number;
};

type MediaHealthIssue = 
  | "vfr"           // Variable frame rate detected
  | "vfr_suspected" // VFR likely based on frame rate mismatch
  | "low_fps"       // Unusually low frame rate
  | "audio_mismatch"; // Audio codec that may cause sync issues

function getMediaHealthIssueDescription(issue: MediaHealthIssue): string {
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

function getMediaHealthStatusLabel(health: MediaHealthStatus): { 
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

function parseFrameRate(value: string): number | null {
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

// Check if media has health issues that require sync-safe conversion
function needsSyncFix(file: MediaFile): boolean {
  const health = computeMediaHealth(file);
  return health.issues.includes("vfr") || health.issues.includes("vfr_suspected");
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper Functions
   ───────────────────────────────────────────────────────────────────────────── */

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

function formatDateAdded(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
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

// Check if an unsupported file has a supported version in the same folder
function checkHasSupportedVersion(file: MediaFile, allFiles: MediaFile[]): boolean {
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

function isAlreadyOptimal(file: MediaFile): boolean {
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

function needsFullReencode(file: MediaFile): boolean {
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

function needsAudioOnlyConversion(file: MediaFile): boolean {
  // Check if it's a compatible container with just bad audio
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const compatibleContainers = ["mp4", "m4v", "mov"];
  if (!compatibleContainers.includes(ext)) return false;
  if (needsFullReencode(file)) return false;
  return hasUnsupportedAudio(file);
}

function getConversionDescription(file: MediaFile, targetResolution: TargetResolution = "original"): string {
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

function copyConvertCommand(
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

function buildConvertCommand(file: MediaFile, mediaRoot: string, targetResolution: TargetResolution = "original"): string {
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

function escapeDoubleQuotes(value: string): string {
  return value.replace(/(["\\`$])/g, "\\$1");
}

