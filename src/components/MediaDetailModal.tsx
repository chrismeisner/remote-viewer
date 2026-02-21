"use client";

import { useEffect, useState, useRef, useCallback, useMemo, useImperativeHandle, forwardRef } from "react";
import { REMOTE_MEDIA_BASE, type MediaSource } from "@/constants/media";
import { cleanupFilename } from "@/lib/filename-utils";
import {
  type MediaFile,
  type MediaMetadata,
  type TargetResolution,
  type CoverOption,
  type MediaHealthStatus,
  type MediaHealthIssue,
  isBrowserSupported,
  hasUnsupportedAudio,
  needsSyncFix,
  isAlreadyOptimal,
  needsFullReencode,
  needsAudioOnlyConversion,
  getConversionDescription,
  copyConvertCommand,
  checkHasSupportedVersion,
  computeMediaHealth,
  getMediaHealthIssueDescription,
  getMediaHealthStatusLabel,
  parseFrameRate,
} from "@/lib/media-utils";

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

/* ─────────────────────────────────────────────────────────────────────────────
   Media Detail Modal Component
   ───────────────────────────────────────────────────────────────────────────── */
export default function MediaDetailModal({
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
  const coverRef = useRef<CoverSectionHandle>(null);
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
  const [editReleaseDate, setEditReleaseDate] = useState<string>("");
  const [editDirector, setEditDirector] = useState<string>("");
  const [editCategory, setEditCategory] = useState<string>("");
  const [editMakingOf, setEditMakingOf] = useState<string>("");
  const [editPlot, setEditPlot] = useState<string>("");
  const [editType, setEditType] = useState<string>("");
  const [editSeason, setEditSeason] = useState<string>("");
  const [editEpisode, setEditEpisode] = useState<string>("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState<string>("");
  const [editImdbUrl, setEditImdbUrl] = useState<string>("");
  const [editEventUrl, setEditEventUrl] = useState<string>("");
  const [availableCovers, setAvailableCovers] = useState<CoverOption[]>([]);
  
  // AI lookup state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiMaxTokens, setAiMaxTokens] = useState<number>(512);
  const [aiLookupMode, setAiLookupMode] = useState<"entertainment" | "sports">("entertainment");
  const [aiContextEnabled, setAiContextEnabled] = useState(false);
  const [aiContextText, setAiContextText] = useState("");

  // Deep search state
  const [deepSearchLoading, setDeepSearchLoading] = useState(false);

  // IMDB search state
  const [imdbSearchOpen, setImdbSearchOpen] = useState(false);
  const [imdbSearchLoading, setImdbSearchLoading] = useState(false);
  const [imdbSearchResults, setImdbSearchResults] = useState<
    { imdbUrl: string; title: string; year: number | null; type: string; rating?: number | null; image?: string | null }[]
  >([]);
  const [imdbSearchError, setImdbSearchError] = useState<string | null>(null);
  const [imdbSearchSelected, setImdbSearchSelected] = useState<string | null>(null);

  // IMDB URL preview state
  const [imdbPreview, setImdbPreview] = useState<{
    title: string;
    year: number | null;
    type: string | null;
    rating: number | null;
    image: string | null;
  } | null>(null);
  const [imdbPreviewLoading, setImdbPreviewLoading] = useState(false);

  // Use IMDB cover checkbox — default to checked
  const [useImdbCover, setUseImdbCover] = useState(true);
  
  // TV cover source: "episode" (still frame) or "series" (poster)
  const [tvCoverSource, setTvCoverSource] = useState<"episode" | "series">("series");
  const [seriesImdbUrl, setSeriesImdbUrl] = useState<string>("");
  const [seriesPreview, setSeriesPreview] = useState<{
    title: string;
    image: string | null;
  } | null>(null);

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

  // Subtitle state
  const [subtitleUploading, setSubtitleUploading] = useState(false);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleSuccess, setSubtitleSuccess] = useState(false);
  const [subtitleRemoving, setSubtitleRemoving] = useState(false);
  const subtitleInputRef = useRef<HTMLInputElement>(null);

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
    setSeriesImdbUrl("");
    setSeriesPreview(null);
    setTvCoverSource("series");

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
            setEditReleaseDate(metaData.metadata.releaseDate ?? "");
            setEditDirector(metaData.metadata.director ?? "");
            setEditCategory(metaData.metadata.category ?? "");
            setEditMakingOf(metaData.metadata.makingOf ?? "");
            setEditPlot(metaData.metadata.plot ?? "");
            setEditType(metaData.metadata.type ?? "");
            setEditSeason(metaData.metadata.season?.toString() ?? "");
            setEditEpisode(metaData.metadata.episode?.toString() ?? "");
            setEditImdbUrl(metaData.metadata.imdbUrl ?? "");
            setEditEventUrl(metaData.metadata.eventUrl ?? "");
            setEditTags(metaData.metadata.tags ?? []);

            // Auto-set lookup mode based on existing metadata type
            if (metaData.metadata.type === "sports") {
              setAiLookupMode("sports");
            } else {
              setAiLookupMode("entertainment");
            }

            // If the item already has a cover set (custom upload, local path, URL, or emoji),
            // default "Use IMDB cover" to unchecked so the auto-load effect doesn't
            // overwrite the existing cover with the IMDB poster.
            // If no cover exists, default to checked so new items get auto-covered.
            const hasExistingCover = !!(
              metaData.metadata.coverLocal ||
              metaData.metadata.coverPath ||
              metaData.metadata.coverUrl ||
              metaData.metadata.coverEmoji
            );
            setUseImdbCover(!hasExistingCover);
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
    console.log("[IMDB Cover] === AI LOOKUP START ===", { file: item.relPath });
    setAiLoading(true);
    setMetadataError(null);
    try {
      // Include existing metadata as context for AI
      const existingMetadata: Record<string, unknown> = {};
      if (metadata.title) existingMetadata.title = metadata.title;
      if (metadata.year) existingMetadata.year = metadata.year;
      if (metadata.releaseDate) existingMetadata.releaseDate = metadata.releaseDate;
      if (metadata.director) existingMetadata.director = metadata.director;
      if (metadata.category) existingMetadata.category = metadata.category;
      if (metadata.makingOf) existingMetadata.makingOf = metadata.makingOf;
      if (metadata.plot) existingMetadata.plot = metadata.plot;
      if (metadata.type) existingMetadata.type = metadata.type;
      if (metadata.season) existingMetadata.season = metadata.season;
      if (metadata.episode) existingMetadata.episode = metadata.episode;
      if (metadata.imdbUrl) existingMetadata.imdbUrl = metadata.imdbUrl;
      if (metadata.eventUrl) existingMetadata.eventUrl = metadata.eventUrl;

      const maxTokens = aiMaxTokens;

      console.log("[AI Lookup] Calling AI lookup API...", { maxTokens, lookupMode: aiLookupMode, existingMetadata });
      const res = await fetch("/api/media-metadata/ai-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          filename: item.relPath,
          existingMetadata: Object.keys(existingMetadata).length > 0 ? existingMetadata : undefined,
          maxTokens,
          userContext: aiContextEnabled && aiContextText.trim() ? aiContextText.trim() : undefined,
          lookupMode: aiLookupMode,
        }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        console.error("[IMDB Cover] AI lookup API error:", data.error);
        throw new Error(data.error || "AI lookup failed");
      }
      
      console.log("[IMDB Cover] AI lookup response:", { 
        title: data.title, 
        year: data.year, 
        type: data.type,
        imdbUrl: data.imdbUrl || "(none)", 
        seriesImdbUrl: data.seriesImdbUrl || "(none)" 
      });
      
      // Fill in the edit fields with AI response
      if (data.title) setEditTitle(data.title);
      if (data.year) setEditYear(data.year.toString());
      if (data.releaseDate) setEditReleaseDate(data.releaseDate);
      if (data.director) setEditDirector(data.director);
      if (data.category) setEditCategory(data.category);
      if (data.makingOf) setEditMakingOf(data.makingOf);
      if (data.plot) setEditPlot(data.plot);
      if (data.type) setEditType(data.type);
      if (data.season) setEditSeason(data.season.toString());
      if (data.episode) setEditEpisode(data.episode.toString());
      if (data.imdbUrl) {
        console.log("[IMDB Cover] Setting editImdbUrl from AI:", data.imdbUrl);
        setEditImdbUrl(data.imdbUrl);
      }
      if (data.eventUrl) {
        console.log("[AI Lookup] Setting editEventUrl from AI:", data.eventUrl);
        setEditEventUrl(data.eventUrl);
      }
      if (data.seriesImdbUrl) {
        console.log("[IMDB Cover] Setting seriesImdbUrl from AI:", data.seriesImdbUrl);
        setSeriesImdbUrl(data.seriesImdbUrl);
      }
      
      // Switch to edit mode to show the filled fields
      setEditingMetadata(true);

      // Also run IMDB search to find/verify the best IMDB URL
      // Skip IMDB search in sports mode — sports content uses eventUrl instead
      const searchTitle = data.title || metadata.title;
      if (aiLookupMode !== "sports" && searchTitle && !data.imdbUrl) {
        // Only auto-search if AI didn't already return an IMDB URL
        console.log("[IMDB Cover] AI returned no IMDB URL, running auto-search for:", searchTitle);
        try {
          const imdbRes = await fetch("/api/media-metadata/imdb-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: item.relPath.split("/").pop() || item.relPath,
              title: searchTitle,
              year: data.year || metadata.year || undefined,
              type: data.type || metadata.type || undefined,
              director: data.director || metadata.director || undefined,
              category: data.category || metadata.category || undefined,
              season: data.season || metadata.season || undefined,
              episode: data.episode || metadata.episode || undefined,
            }),
          });
          if (imdbRes.ok) {
            const imdbData = await imdbRes.json();
            console.log("[IMDB Cover] IMDB auto-search results:", imdbData.candidates?.length || 0, "candidates");
            if (imdbData.candidates?.length > 0) {
              console.log("[IMDB Cover] Auto-filling top IMDB result:", imdbData.candidates[0].imdbUrl);
              // Auto-fill the top result as our best guess
              setEditImdbUrl(imdbData.candidates[0].imdbUrl);
            } else {
              console.log("[IMDB Cover] No IMDB candidates found from auto-search");
            }
          } else {
            console.warn("[IMDB Cover] IMDB auto-search returned non-OK status:", imdbRes.status);
          }
        } catch (searchErr) {
          // IMDB search is best-effort — don't block the AI fill
          console.warn("[IMDB Cover] IMDB auto-search failed, skipping:", searchErr);
        }
      } else if (aiLookupMode === "sports") {
        // In sports mode, search for a real event URL using the date + teams from AI
        console.log("[AI Lookup] Sports mode — searching for verified event URL");
        const gameDate = data.releaseDate;
        const gameTitle = data.title || "";
        const gameSport = data.category || "Basketball";
        if (gameDate && /^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
          try {
            // Parse team names from title (e.g., "Bulls vs Lakers" or "Bulls @ Lakers")
            const titleParts = gameTitle.split(/\s+(?:vs\.?|@|at|versus)\s+/i);
            const team1 = titleParts[0]?.trim() || undefined;
            const team2 = titleParts[1]?.trim() || undefined;
            console.log("[Event Search] Searching:", { date: gameDate, sport: gameSport, team1, team2 });
            const eventRes = await fetch("/api/media-metadata/event-search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sport: gameSport,
                date: gameDate,
                team1,
                team2,
              }),
            });
            if (eventRes.ok) {
              const eventData = await eventRes.json();
              if (eventData.bestMatch?.boxScoreUrl) {
                console.log("[Event Search] Found verified URL:", eventData.bestMatch.boxScoreUrl);
                setEditEventUrl(eventData.bestMatch.boxScoreUrl);
              } else {
                console.log("[Event Search] No matching game found in", eventData.games?.length || 0, "games on", gameDate);
              }
            }
          } catch (eventErr) {
            console.warn("[Event Search] Event search failed, keeping AI URL:", eventErr);
          }
        } else {
          console.log("[AI Lookup] No valid date for event search, keeping AI URL");
        }
      } else if (data.imdbUrl) {
        console.log("[AI Lookup] AI already returned IMDB URL, skipping auto-search");
      } else {
        console.log("[AI Lookup] No title available for IMDB auto-search");
      }
      console.log("[AI Lookup] === AI LOOKUP COMPLETE ===");
    } catch (err) {
      console.error("[IMDB Cover] AI lookup failed:", err);
      setMetadataError(err instanceof Error ? err.message : "AI lookup failed");
    } finally {
      setAiLoading(false);
    }
  };

  // Deep search: uses all existing metadata to do a thorough, targeted AI lookup
  const handleDeepSearch = async () => {
    console.log("[Deep Search] === DEEP SEARCH START ===", { file: item.relPath });
    setDeepSearchLoading(true);
    setMetadataError(null);
    try {
      // Collect ALL current metadata (from edit fields if editing, otherwise from saved metadata)
      const currentMetadata = {
        title: editingMetadata ? editTitle.trim() : metadata.title,
        year: editingMetadata ? (editYear ? parseInt(editYear, 10) : null) : metadata.year,
        releaseDate: editingMetadata ? editReleaseDate.trim() : metadata.releaseDate,
        director: editingMetadata ? editDirector.trim() : metadata.director,
        category: editingMetadata ? editCategory.trim() : metadata.category,
        makingOf: editingMetadata ? editMakingOf.trim() : metadata.makingOf,
        plot: editingMetadata ? editPlot.trim() : metadata.plot,
        type: editingMetadata ? editType : metadata.type,
        season: editingMetadata ? (editSeason ? parseInt(editSeason, 10) : null) : metadata.season,
        episode: editingMetadata ? (editEpisode ? parseInt(editEpisode, 10) : null) : metadata.episode,
        imdbUrl: editingMetadata ? editImdbUrl.trim() : metadata.imdbUrl,
        eventUrl: editingMetadata ? editEventUrl.trim() : metadata.eventUrl,
        tags: editingMetadata ? editTags : metadata.tags,
      };

      console.log("[Deep Search] Sending metadata context:", {
        title: currentMetadata.title,
        type: currentMetadata.type,
        season: currentMetadata.season,
        episode: currentMetadata.episode,
        imdbUrl: currentMetadata.imdbUrl,
        eventUrl: currentMetadata.eventUrl,
        lookupMode: aiLookupMode,
        userContext: aiContextEnabled && aiContextText.trim() ? aiContextText.trim() : "(none)",
      });

      const res = await fetch("/api/media-metadata/deep-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: item.relPath,
          existingMetadata: currentMetadata,
          lookupMode: aiLookupMode,
          userContext: aiContextEnabled && aiContextText.trim() ? aiContextText.trim() : undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        console.error("[Deep Search] API error:", data.error);
        throw new Error(data.error || "Deep search failed");
      }

      console.log("[Deep Search] Response:", {
        title: data.title,
        type: data.type,
        eventUrl: data.eventUrl || "(none)",
        plotLength: data.plot?.length || 0,
        makingOfLength: data.makingOf?.length || 0,
        tagsCount: data.tags?.length || 0,
      });

      // Fill in edit fields with deep search results
      if (data.title) setEditTitle(data.title);
      if (data.year) setEditYear(data.year.toString());
      if (data.releaseDate) setEditReleaseDate(data.releaseDate);
      if (data.director) setEditDirector(data.director);
      if (data.category) setEditCategory(data.category);
      if (data.makingOf) setEditMakingOf(data.makingOf);
      if (data.plot) setEditPlot(data.plot);
      if (data.type) setEditType(data.type);
      if (data.season) setEditSeason(data.season.toString());
      if (data.episode) setEditEpisode(data.episode.toString());
      if (data.imdbUrl) setEditImdbUrl(data.imdbUrl);
      if (data.eventUrl) setEditEventUrl(data.eventUrl);
      if (data.tags && Array.isArray(data.tags)) setEditTags(data.tags);

      // Switch to edit mode to show the filled fields
      setEditingMetadata(true);

      // For sports content, search for a verified event URL using the date + teams
      const deepType = data.type || currentMetadata.type;
      const deepDate = data.releaseDate || currentMetadata.releaseDate;
      const deepTitle = data.title || currentMetadata.title || "";
      const deepSport = data.category || currentMetadata.category || "Basketball";
      if ((aiLookupMode === "sports" || deepType === "sports") && deepDate && /^\d{4}-\d{2}-\d{2}$/.test(deepDate)) {
        console.log("[Deep Search] Searching for verified event URL...");
        try {
          const titleParts = deepTitle.split(/\s+(?:vs\.?|@|at|versus)\s+/i);
          const team1 = titleParts[0]?.trim() || undefined;
          const team2 = titleParts[1]?.trim() || undefined;
          const eventRes = await fetch("/api/media-metadata/event-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sport: deepSport,
              date: deepDate,
              team1,
              team2,
            }),
          });
          if (eventRes.ok) {
            const eventData = await eventRes.json();
            if (eventData.bestMatch?.boxScoreUrl) {
              console.log("[Deep Search] Found verified event URL:", eventData.bestMatch.boxScoreUrl);
              setEditEventUrl(eventData.bestMatch.boxScoreUrl);
            } else {
              console.log("[Deep Search] No matching game found — keeping AI URL");
            }
          }
        } catch (eventErr) {
          console.warn("[Deep Search] Event search failed:", eventErr);
        }
      }

      console.log("[Deep Search] === DEEP SEARCH COMPLETE ===");
    } catch (err) {
      console.error("[Deep Search] Failed:", err);
      setMetadataError(err instanceof Error ? err.message : "Deep search failed");
    } finally {
      setDeepSearchLoading(false);
    }
  };

  const handleSaveAll = async () => {
    console.log("[IMDB Cover] === SAVE START ===", { file: item.relPath });
    console.log("[IMDB Cover] Save state:", {
      useImdbCover,
      hasImdbPreview: !!imdbPreview,
      imdbPreviewImage: imdbPreview?.image ? imdbPreview.image.substring(0, 80) + "..." : "(none)",
      imdbPreviewType: imdbPreview?.type || "(none)",
      hasSeriesPreview: !!seriesPreview,
      seriesPreviewImage: seriesPreview?.image ? "yes" : "(none)",
      tvCoverSource,
      editImdbUrl: editImdbUrl || "(empty)",
    });
    setMetadataSaving(true);
    setMetadataError(null);
    try {
      // Build metadata payload
      const payload: Record<string, unknown> = {
        file: item.relPath,
        source: mediaSource,
        title: editTitle.trim() || null,
        year: editYear ? parseInt(editYear, 10) : null,
        releaseDate: editReleaseDate.trim() || null,
        director: editDirector.trim() || null,
        category: editCategory.trim() || null,
        makingOf: editMakingOf.trim() || null,
        plot: editPlot.trim() || null,
        type: editType || null,
        season: editSeason ? parseInt(editSeason, 10) : null,
        episode: editEpisode ? parseInt(editEpisode, 10) : null,
        imdbUrl: editImdbUrl.trim() || null,
        eventUrl: editEventUrl.trim() || null,
        tags: editTags.length > 0 ? editTags : null,
      };

      // If "use cover art" is checked, include the IMDB cover image
      if (useImdbCover && editImdbUrl.trim()) {
        if (imdbPreview?.image) {
          // Preview already loaded — use it directly
          if (imdbPreview.type === "tvEpisode" && seriesPreview?.image && tvCoverSource === "series") {
            console.log("[IMDB Cover] Using SERIES poster as cover:", seriesPreview.image.substring(0, 80) + "...");
            payload.coverUrl = seriesPreview.image;
          } else {
            console.log("[IMDB Cover] Using IMDB preview image as cover:", imdbPreview.image.substring(0, 80) + "...");
            payload.coverUrl = imdbPreview.image;
          }
        } else {
          // Preview not loaded yet — fetch cover from IMDB on the fly
          console.log("[IMDB Cover] No preview image yet, fetching cover from IMDB...");
          try {
            const coverRes = await fetch("/api/media-metadata/imdb-cover", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imdbUrl: editImdbUrl.trim() }),
            });
            if (coverRes.ok) {
              const coverData = await coverRes.json();
              if (coverData.coverUrl) {
                console.log("[IMDB Cover] Fetched cover on save:", coverData.coverUrl.substring(0, 80) + "...");
                payload.coverUrl = coverData.coverUrl;
              }
            }
          } catch (coverErr) {
            console.warn("[IMDB Cover] Failed to fetch cover on save:", coverErr);
          }
        }
        payload.coverEmoji = null;
      } else if (coverRef.current) {
        // Merge cover data from the cover section
        const coverPayload = coverRef.current.getSavePayload();
        console.log("[IMDB Cover] Using cover section payload:", coverPayload);
        Object.assign(payload, coverPayload);
      } else {
        console.log("[IMDB Cover] No cover data to include in save (useImdbCover:", useImdbCover, ", imdbPreview?.image:", !!imdbPreview?.image, ", coverRef:", !!coverRef.current, ")");
      }

      console.log("[IMDB Cover] Final payload coverUrl:", payload.coverUrl || "(none)");

      const res = await fetch("/api/media-metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("[IMDB Cover] Save API error:", data.error);
        throw new Error(data.error || "Failed to save");
      }
      console.log("[IMDB Cover] Save SUCCESS — saved coverUrl:", data.metadata?.coverUrl || "(none)");
      setMetadata(data.metadata);
      setEditingMetadata(false);
      setUseImdbCover(false);
      // Notify parent to update the table, then close the modal
      onMetadataUpdate?.(item.relPath, data.metadata);
      onClose();
    } catch (err) {
      console.error("[IMDB Cover] Save FAILED:", err);
      setMetadataError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setMetadataSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditTitle(metadata.title ?? "");
    setEditYear(metadata.year?.toString() ?? "");
    setEditReleaseDate(metadata.releaseDate ?? "");
    setEditDirector(metadata.director ?? "");
    setEditCategory(metadata.category ?? "");
    setEditMakingOf(metadata.makingOf ?? "");
    setEditPlot(metadata.plot ?? "");
    setEditType(metadata.type ?? "");
    setEditSeason(metadata.season?.toString() ?? "");
    setEditEpisode(metadata.episode?.toString() ?? "");
    setEditImdbUrl(metadata.imdbUrl ?? "");
    setEditEventUrl(metadata.eventUrl ?? "");
    setEditTags(metadata.tags ?? []);
    setNewTagInput("");
    setEditingMetadata(false);
    setMetadataError(null);
  };

  // Clear all metadata for the current item
  const handleClearMetadata = async () => {
    if (!confirm("Are you sure you want to clear all metadata for this item? This action cannot be undone.")) {
      return;
    }

    setMetadataSaving(true);
    setMetadataError(null);
    try {
      // Send all fields as null to clear them
      const payload = {
        file: item.relPath,
        source: mediaSource,
        title: null,
        year: null,
        releaseDate: null,
        director: null,
        category: null,
        makingOf: null,
        plot: null,
        type: null,
        season: null,
        episode: null,
        imdbUrl: null,
        eventUrl: null,
        tags: null,
        coverUrl: null,
        coverLocal: null,
        coverEmoji: null,
      };

      const res = await fetch("/api/media-metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to clear metadata");
      }

      const data = await res.json();
      
      // Update local state to reflect cleared metadata
      const clearedMetadata: MediaMetadata = {};
      setMetadata(clearedMetadata);
      setEditTitle("");
      setEditYear("");
      setEditReleaseDate("");
      setEditDirector("");
      setEditCategory("");
      setEditMakingOf("");
      setEditPlot("");
      setEditType("");
      setEditSeason("");
      setEditEpisode("");
      setEditImdbUrl("");
      setEditEventUrl("");
      setEditTags([]);
      setNewTagInput("");
      setImdbPreview(null);
      setSeriesPreview(null);
      
      // Notify parent component if callback provided
      if (onMetadataUpdate) {
        onMetadataUpdate(item.relPath, clearedMetadata);
      }

      // Exit edit mode
      setEditingMetadata(false);
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : "Failed to clear metadata");
    } finally {
      setMetadataSaving(false);
    }
  };

  // IMDB search: trigger AI lookup for IMDB URL candidates
  const handleImdbSearch = async () => {
    console.log("[IMDB Cover] === MANUAL IMDB SEARCH START ===");
    setImdbSearchOpen(true);
    setImdbSearchLoading(true);
    setImdbSearchError(null);
    setImdbSearchResults([]);
    setImdbSearchSelected(null);

    const searchParams = {
      filename: item.relPath.split("/").pop() || item.relPath,
      title: editTitle.trim() || metadata.title || undefined,
      year: editYear ? parseInt(editYear, 10) : metadata.year || undefined,
      type: editType || metadata.type || undefined,
      director: editDirector.trim() || metadata.director || undefined,
      category: editCategory.trim() || metadata.category || undefined,
      season: editSeason ? parseInt(editSeason, 10) : metadata.season || undefined,
      episode: editEpisode ? parseInt(editEpisode, 10) : metadata.episode || undefined,
    };
    console.log("[IMDB Cover] Search params:", searchParams);

    try {
      const res = await fetch("/api/media-metadata/imdb-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchParams),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        console.error("[IMDB Cover] IMDB search API error:", res.status, errData?.error);
        throw new Error(errData?.error || `Search failed (${res.status})`);
      }
      const data = await res.json();
      if (!data.candidates || data.candidates.length === 0) {
        console.log("[IMDB Cover] IMDB search returned 0 candidates");
        setImdbSearchError("No IMDB matches found. Try editing the title or year first.");
      } else {
        console.log("[IMDB Cover] IMDB search returned", data.candidates.length, "candidates:", 
          data.candidates.map((c: { imdbUrl: string; title: string }) => `${c.title} (${c.imdbUrl})`));
        setImdbSearchResults(data.candidates);
        // Auto-select the first (highest confidence) result
        setImdbSearchSelected(data.candidates[0].imdbUrl);
      }
    } catch (err) {
      console.error("[IMDB Cover] IMDB search FAILED:", err);
      setImdbSearchError(err instanceof Error ? err.message : "IMDB search failed");
    } finally {
      setImdbSearchLoading(false);
    }
  };

  const handleImdbSearchConfirm = () => {
    console.log("[IMDB Cover] IMDB search confirmed, setting editImdbUrl:", imdbSearchSelected || "(none)");
    if (imdbSearchSelected) {
      setEditImdbUrl(imdbSearchSelected);
    }
    setImdbSearchOpen(false);
  };

  const handleMetadataKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !metadataSaving) {
      e.preventDefault();
      handleSaveAll();
    }
  };

  // Subtitle handlers
  const handleSubtitleUpload = async (file: File) => {
    console.log("[admin] subtitle upload started", {
      fileName: file.name,
      fileSize: file.size,
      relPath: currentRelPath,
      source: mediaSource,
    });
    setSubtitleUploading(true);
    setSubtitleError(null);
    setSubtitleSuccess(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("relPath", currentRelPath);
      formData.append("source", mediaSource);
      const res = await fetch("/api/subtitles", { method: "POST", body: formData });
      const data = await res.json();
      console.log("[admin] subtitle upload response", { ok: res.ok, data });
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setMetadata((prev) => ({ ...prev, subtitleFile: data.subtitleFile }));
      setSubtitleSuccess(true);
      setTimeout(() => setSubtitleSuccess(false), 3000);
      if (onMetadataUpdate) {
        onMetadataUpdate(currentRelPath, { ...metadata, subtitleFile: data.subtitleFile });
      }
    } catch (err) {
      console.error("[admin] subtitle upload failed", err);
      setSubtitleError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubtitleUploading(false);
    }
  };

  const handleSubtitleRemove = async () => {
    console.log("[admin] subtitle remove started", { relPath: currentRelPath, source: mediaSource });
    setSubtitleRemoving(true);
    setSubtitleError(null);
    try {
      const res = await fetch(
        `/api/subtitles?relPath=${encodeURIComponent(currentRelPath)}&source=${mediaSource}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      console.log("[admin] subtitle remove response", { ok: res.ok, data });
      if (!res.ok) throw new Error(data.error || "Remove failed");
      setMetadata((prev) => {
        const next = { ...prev };
        delete next.subtitleFile;
        return next;
      });
      if (onMetadataUpdate) {
        onMetadataUpdate(currentRelPath, { ...metadata, subtitleFile: null });
      }
    } catch (err) {
      console.error("[admin] subtitle remove failed", err);
      setSubtitleError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setSubtitleRemoving(false);
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

  // Handle escape key to close modal (sub-modal first, then parent)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (imdbSearchOpen) {
          setImdbSearchOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, imdbSearchOpen]);

  // Reset copied state when item changes
  useEffect(() => {
    setCopiedCommand(false);
  }, [item]);

  // Fetch IMDB title preview when URL changes
  useEffect(() => {
    console.log("[IMDB Cover] useEffect triggered — editImdbUrl changed:", editImdbUrl || "(empty)");
    const imdbIdMatch = editImdbUrl.match(/\/title\/(tt\d{7,8})/);
    if (!imdbIdMatch) {
      console.log("[IMDB Cover] No valid IMDB ID found in URL, clearing preview");
      setImdbPreview(null);
      setImdbPreviewLoading(false);
      return;
    }

    const titleId = imdbIdMatch[1];
    let cancelled = false;

    console.log("[IMDB Cover] Fetching IMDB preview for:", titleId);
    setImdbPreviewLoading(true);
    setImdbPreview(null);

    fetch(`/api/media-metadata/imdb-preview?id=${titleId}`)
      .then((res) => {
        console.log("[IMDB Cover] Preview API response status:", res.status);
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) {
          console.log("[IMDB Cover] Preview fetch was cancelled (stale), ignoring");
          return;
        }
        const image = data.image ?? null;
        console.log("[IMDB Cover] Preview loaded:", {
          title: data.title,
          year: data.year,
          type: data.type,
          rating: data.rating,
          hasImage: !!image,
          imageUrl: image ? image.substring(0, 80) + "..." : "(none)",
        });
        setImdbPreview({
          title: data.title || null,
          year: data.year ?? null,
          type: data.type || null,
          rating: data.rating ?? null,
          image,
        });
      })
      .catch((err) => {
        console.error("[IMDB Cover] Preview fetch FAILED:", err);
        if (!cancelled) setImdbPreview(null);
      })
      .finally(() => {
        if (!cancelled) setImdbPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editImdbUrl]);

  // Fetch series preview image when we have a series IMDB URL (for TV cover source picker)
  useEffect(() => {
    console.log("[IMDB Cover] Series useEffect triggered — seriesImdbUrl:", seriesImdbUrl || "(empty)");
    const seriesIdMatch = seriesImdbUrl.match(/\/title\/(tt\d{7,8})/);
    if (!seriesIdMatch) {
      console.log("[IMDB Cover] No valid series IMDB ID, clearing series preview");
      setSeriesPreview(null);
      return;
    }

    const seriesId = seriesIdMatch[1];
    let cancelled = false;

    console.log("[IMDB Cover] Fetching series preview for:", seriesId);
    fetch(`/api/media-metadata/imdb-preview?id=${seriesId}`)
      .then((res) => {
        console.log("[IMDB Cover] Series preview API response status:", res.status);
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) {
          console.log("[IMDB Cover] Series fetch was cancelled (stale), ignoring");
          return;
        }
        const seriesImage = data.image ?? null;
        console.log("[IMDB Cover] Series preview loaded:", {
          title: data.title,
          hasImage: !!seriesImage,
        });
        setSeriesPreview({
          title: data.title || null,
          image: seriesImage,
        });
      })
      .catch((err) => {
        console.error("[IMDB Cover] Series preview fetch FAILED:", err);
        if (!cancelled) setSeriesPreview(null);
      });

    return () => {
      cancelled = true;
    };
  }, [seriesImdbUrl]);

  // Auto-load IMDB cover into Cover section when "use cover art" is checked
  // and we have a preview image (or series image for TV content)
  useEffect(() => {
    if (!useImdbCover || !coverRef.current) return;

    // For TV episodes using series poster
    if (imdbPreview?.type === "tvEpisode" && seriesPreview?.image && tvCoverSource === "series") {
      coverRef.current.setCoverFromUrl(seriesPreview.image);
    } else if (imdbPreview?.image) {
      coverRef.current.setCoverFromUrl(imdbPreview.image);
    }
  }, [useImdbCover, imdbPreview?.image, imdbPreview?.type, seriesPreview?.image, tvCoverSource]);

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
          <div className="ml-4 flex flex-shrink-0 items-center gap-2">
            <a
              href={`/watch?file=${encodeURIComponent(currentRelPath)}&source=${mediaSource}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-emerald-400/40 hover:bg-emerald-500/10 hover:text-emerald-200"
              title="Watch from beginning in new tab"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Watch
            </a>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-neutral-100 transition"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
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

        {/* Subtitles Section */}
        <div className="border-t border-white/10 bg-neutral-800/30 px-5 py-4">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3">Subtitles</h3>
          <input
            ref={subtitleInputRef}
            type="file"
            accept=".srt,.vtt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleSubtitleUpload(file);
              e.target.value = "";
            }}
          />

          {metadata.subtitleFile ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Active
                </span>
                <span className="text-sm text-neutral-300 font-mono truncate" title={metadata.subtitleFile}>
                  {metadata.subtitleFile.split("/").pop()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => subtitleInputRef.current?.click()}
                  disabled={subtitleUploading}
                  className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:bg-white/10 disabled:opacity-50"
                >
                  {subtitleUploading ? "Uploading..." : "Replace"}
                </button>
                <button
                  onClick={handleSubtitleRemove}
                  disabled={subtitleRemoving}
                  className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                >
                  {subtitleRemoving ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-neutral-500">No subtitles attached. Upload a .srt or .vtt file.</p>
              <button
                onClick={() => subtitleInputRef.current?.click()}
                disabled={subtitleUploading}
                className="rounded-md border border-white/20 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {subtitleUploading ? "Uploading..." : "Upload subtitle file"}
              </button>
            </div>
          )}

          {subtitleSuccess && (
            <p className="mt-2 text-xs text-emerald-300">Subtitle uploaded successfully.</p>
          )}
          {subtitleError && (
            <p className="mt-2 text-xs text-red-400">{subtitleError}</p>
          )}
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
                <div className="flex flex-col gap-2">
                  {/* Lookup mode toggle */}
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-md border border-white/15 overflow-hidden" role="group">
                      <button
                        type="button"
                        onClick={() => setAiLookupMode("entertainment")}
                        disabled={aiLoading}
                        className={`px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                          aiLookupMode === "entertainment"
                            ? "bg-amber-500/20 text-amber-300 border-r border-white/15"
                            : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-neutral-300 border-r border-white/15"
                        }`}
                      >
                        Film / TV
                      </button>
                      <button
                        type="button"
                        onClick={() => setAiLookupMode("sports")}
                        disabled={aiLoading}
                        className={`px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                          aiLookupMode === "sports"
                            ? "bg-sky-500/20 text-sky-300"
                            : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-neutral-300"
                        }`}
                      >
                        Sporting Event
                      </button>
                    </div>
                    <select
                      value={aiMaxTokens}
                      onChange={(e) => setAiMaxTokens(Number(e.target.value))}
                      disabled={aiLoading}
                      className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-300 outline-none focus:border-blue-300 disabled:opacity-50"
                      title="Max tokens for AI response"
                    >
                      <option value={256}>256 tokens</option>
                      <option value={512}>512 tokens</option>
                      <option value={1024}>1024 tokens</option>
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
                      placeholder={aiLookupMode === "sports" ? "e.g. NBA game, Chicago Bulls home game..." : "e.g. This is a 1980s horror film..."}
                      className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-blue-300 disabled:opacity-50"
                    />
                  )}
                </div>
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
                  <label className="block text-xs text-neutral-500 mb-1">Release Date</label>
                  <input
                    type="date"
                    value={editReleaseDate}
                    onChange={(e) => setEditReleaseDate(e.target.value)}
                    onKeyDown={handleMetadataKeyDown}
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
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-xs text-neutral-500">IMDB URL</label>
                  <button
                    type="button"
                    onClick={handleImdbSearch}
                    disabled={imdbSearchLoading}
                    className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 disabled:opacity-50 disabled:cursor-wait"
                  >
                    {imdbSearchLoading ? "Searching..." : "Look up IMDB"}
                  </button>
                </div>
                <input
                  type="url"
                  value={editImdbUrl}
                  onChange={(e) => setEditImdbUrl(e.target.value)}
                  onKeyDown={handleMetadataKeyDown}
                  placeholder="e.g. https://www.imdb.com/title/tt0133093/"
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                />
                {/* IMDB preview */}
                {imdbPreviewLoading && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-3 w-3 animate-spin rounded-full border border-neutral-600 border-t-neutral-300" />
                    <span className="text-xs text-neutral-500">Looking up IMDB...</span>
                  </div>
                )}
                {imdbPreview && !imdbPreviewLoading && (
                  <div className="mt-1.5 flex items-center gap-2.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
                    {imdbPreview.image && (
                      <img
                        src={imdbPreview.image}
                        alt={imdbPreview.title}
                        className="h-10 w-7 rounded object-cover shrink-0 bg-neutral-800"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-neutral-200 truncate">
                        {imdbPreview.title}
                        {imdbPreview.year ? (
                          <span className="ml-1 text-neutral-500">({imdbPreview.year})</span>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {imdbPreview.type && (
                          <span className="text-[10px] uppercase text-neutral-500">{imdbPreview.type}</span>
                        )}
                        {imdbPreview.rating != null && (
                          <span className="text-[10px] text-amber-400/80">&#9733; {imdbPreview.rating.toFixed(1)}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-emerald-400 shrink-0">&#10003; Verified</span>
                  </div>
                )}
                {/* Use cover art checkbox — visible whenever an IMDB URL is entered */}
                {editImdbUrl.trim() && (
                  <div className="mt-1.5">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={useImdbCover}
                        onChange={(e) => setUseImdbCover(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-800 text-amber-500 accent-amber-500"
                      />
                      <span className="text-xs text-neutral-300 group-hover:text-neutral-200">Use cover art</span>
                      {useImdbCover && imdbPreviewLoading && (
                        <div className="h-3 w-3 animate-spin rounded-full border border-neutral-600 border-t-neutral-300" />
                      )}
                    </label>
                    
                    {/* TV Episode Cover Source Picker */}
                    {useImdbCover && imdbPreview?.type === "tvEpisode" && (
                      <div className="mt-3 pl-5 space-y-2.5 border-l-2 border-amber-500/30">
                        <p className="text-[11px] uppercase tracking-wide text-neutral-500 font-semibold">TV Cover Source</p>
                        
                        {/* Radio: Episode Still Frame */}
                        <label className="flex items-start gap-2.5 cursor-pointer group">
                          <input
                            type="radio"
                            name="tvCoverSource"
                            value="episode"
                            checked={tvCoverSource === "episode"}
                            onChange={(e) => setTvCoverSource(e.target.value as "episode" | "series")}
                            className="mt-0.5 h-3.5 w-3.5 rounded-full border-neutral-600 bg-neutral-800 text-blue-500 accent-blue-500"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-neutral-200 group-hover:text-neutral-100">Episode Still Frame</span>
                              {imdbPreview.image && tvCoverSource === "episode" && (
                                <span className="text-[10px] text-blue-400">✓ Active</span>
                              )}
                            </div>
                            <p className="text-[11px] text-neutral-500 mt-0.5">Use the episode's screenshot</p>
                          </div>
                        </label>
                        
                        {/* Radio: Series Poster */}
                        <label className="flex items-start gap-2.5 cursor-pointer group">
                          <input
                            type="radio"
                            name="tvCoverSource"
                            value="series"
                            checked={tvCoverSource === "series"}
                            onChange={(e) => setTvCoverSource(e.target.value as "episode" | "series")}
                            className="mt-0.5 h-3.5 w-3.5 rounded-full border-neutral-600 bg-neutral-800 text-blue-500 accent-blue-500"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-neutral-200 group-hover:text-neutral-100">Series Poster</span>
                              {seriesPreview?.image && tvCoverSource === "series" && (
                                <span className="text-[10px] text-blue-400">✓ Active</span>
                              )}
                            </div>
                            <p className="text-[11px] text-neutral-500 mt-0.5">Use the TV series poster</p>
                          </div>
                        </label>
                        
                        {/* Series IMDB URL input - only when "series" is selected */}
                        {tvCoverSource === "series" && (
                          <div className="space-y-1.5">
                            <label className="block text-[11px] text-neutral-500">Series IMDB URL</label>
                            <input
                              type="url"
                              value={seriesImdbUrl}
                              onChange={(e) => setSeriesImdbUrl(e.target.value)}
                              placeholder="e.g. https://www.imdb.com/title/tt0903747/"
                              className="w-full rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-blue-300 focus:bg-white/10"
                            />
                            
                            {/* Series preview */}
                            {seriesPreview && (
                              <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1.5">
                                {seriesPreview.image && (
                                  <img
                                    src={seriesPreview.image}
                                    alt={seriesPreview.title}
                                    className="h-8 w-6 rounded object-cover shrink-0 bg-neutral-800"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-medium text-neutral-200 truncate">
                                    {seriesPreview.title}
                                  </p>
                                </div>
                                <span className="text-[9px] text-emerald-400 shrink-0">✓</span>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Save Cover Source Button */}
                        <button
                          onClick={handleSaveAll}
                          disabled={metadataSaving || aiLoading || deepSearchLoading}
                          className="w-full rounded-md bg-blue-500 hover:bg-blue-400 px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {metadataSaving ? "Saving..." : "Save Cover Selection"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Event URL — shown for sports content or when a value exists */}
              {(editType === "sports" || editEventUrl.trim()) && (
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">
                    Event URL <span className="text-neutral-600">(Basketball Reference, ESPN, etc.)</span>
                  </label>
                  <input
                    type="url"
                    value={editEventUrl}
                    onChange={(e) => setEditEventUrl(e.target.value)}
                    onKeyDown={handleMetadataKeyDown}
                    placeholder="e.g. https://www.basketball-reference.com/boxscores/199702020CHI.html"
                    className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
                  />
                  {editEventUrl.trim() && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <a
                        href={editEventUrl.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2"
                      >
                        Open event page ↗
                      </a>
                    </div>
                  )}
                </div>
              )}
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
                  <p className="text-xs text-neutral-500 mb-1">Release Date</p>
                  <p className="text-sm font-medium text-neutral-200">
                    {metadata.releaseDate ?? "—"}
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
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                <p className="text-xs text-neutral-500 mb-1">IMDB</p>
                {metadata.imdbUrl ? (
                  <a
                    href={metadata.imdbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-amber-400 hover:text-amber-300 underline underline-offset-2"
                  >
                    View on IMDB ↗
                  </a>
                ) : (
                  <p className="text-sm text-neutral-500">—</p>
                )}
              </div>
              {/* Event URL — shown for sports content or when a value exists */}
              {(metadata.type === "sports" || metadata.eventUrl) && (
                <div>
                  <p className="text-xs text-neutral-500 mb-1">Event URL</p>
                  {metadata.eventUrl ? (
                    <a
                      href={metadata.eventUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-sky-400 hover:text-sky-300 underline underline-offset-2"
                    >
                      View event page ↗
                    </a>
                  ) : (
                    <p className="text-sm text-neutral-500">—</p>
                  )}
                </div>
              )}
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
          ref={coverRef}
          metadata={metadata}
          availableCovers={availableCovers}
          mediaSource={mediaSource}
          effectiveImdbUrl={editImdbUrl.trim() || metadata.imdbUrl || ""}
          onCoverUploaded={() => setUseImdbCover(false)}
        />

        {/* Unified Save / Cancel / Refill row at very bottom */}
        {editingMetadata && (
          <div className="border-t border-white/10 bg-neutral-800/50 px-5 py-4 space-y-3">
            {metadataError && (
              <p className="text-xs text-amber-300">{metadataError}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleSaveAll}
                disabled={metadataSaving || aiLoading || deepSearchLoading}
                className="rounded-md bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-sm font-semibold text-neutral-900 transition disabled:opacity-50"
              >
                {metadataSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={metadataSaving || aiLoading || deepSearchLoading}
                className="rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-300 transition hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAiLookup}
                disabled={metadataSaving || aiLoading || deepSearchLoading}
                className="rounded-md border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-300 transition hover:bg-blue-500/20 hover:text-blue-200 disabled:opacity-50 flex items-center gap-1.5"
                title="Re-fetch metadata using AI"
              >
                {aiLoading ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Refilling...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refill AI
                  </>
                )}
              </button>
              <button
                onClick={handleDeepSearch}
                disabled={metadataSaving || aiLoading || deepSearchLoading}
                className="rounded-md border border-purple-500/40 bg-purple-500/10 px-4 py-2 text-sm font-semibold text-purple-300 transition hover:bg-purple-500/20 hover:text-purple-200 disabled:opacity-50 flex items-center gap-1.5"
                title="Thorough AI search using all existing metadata to find specific details (episode plots, game stats, setlists, etc.)"
              >
                {deepSearchLoading ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deep searching...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                    </svg>
                    Deep Search
                  </>
                )}
              </button>
              <button
                onClick={handleClearMetadata}
                disabled={metadataSaving || aiLoading || deepSearchLoading}
                className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/20 hover:text-red-200 disabled:opacity-50 flex items-center gap-1.5"
                title="Clear all metadata for this item"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear Metadata
              </button>
            </div>
          </div>
        )}
      </div>

      {/* IMDB Search Sub-Modal (overlay on top of the detail modal) */}
      {imdbSearchOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative w-full max-w-lg mx-4 rounded-xl border border-white/15 bg-neutral-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-neutral-100">IMDB Lookup</h3>
              <button
                onClick={() => setImdbSearchOpen(false)}
                className="rounded-md p-1 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-200"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              {imdbSearchLoading && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                  <p className="text-sm text-neutral-400">Searching IMDB...</p>
                </div>
              )}

              {imdbSearchError && !imdbSearchLoading && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="text-sm text-red-300">{imdbSearchError}</p>
                </div>
              )}

              {!imdbSearchLoading && !imdbSearchError && imdbSearchResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-neutral-500 mb-3">
                    Found {imdbSearchResults.length} possible match{imdbSearchResults.length !== 1 ? "es" : ""}. Select the correct one:
                  </p>
                  {imdbSearchResults.map((result) => (
                    <button
                      key={result.imdbUrl}
                      onClick={() => setImdbSearchSelected(result.imdbUrl)}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition ${
                        imdbSearchSelected === result.imdbUrl
                          ? "border-amber-400/60 bg-amber-400/10"
                          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Poster thumbnail */}
                        {result.image && (
                          <img
                            src={result.image}
                            alt={result.title}
                            className="h-16 w-11 rounded object-cover shrink-0 bg-neutral-800"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-neutral-100 truncate">
                              {result.title}
                              {result.year ? (
                                <span className="ml-1.5 text-neutral-400">({result.year})</span>
                              ) : null}
                            </p>
                            <span className="text-[10px] text-neutral-500 uppercase shrink-0 pt-0.5">{result.type}</span>
                          </div>
                          <p className="text-xs text-neutral-500 mt-0.5 truncate">{result.imdbUrl}</p>
                          {result.rating != null && (
                            <p className="text-xs text-amber-400/80 mt-1">
                              &#9733; {result.rating.toFixed(1)}
                            </p>
                          )}
                          {/* Radio indicator */}
                          <div className="mt-1.5 flex items-center gap-2">
                            <div
                              className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${
                                imdbSearchSelected === result.imdbUrl
                                  ? "border-amber-400"
                                  : "border-neutral-600"
                              }`}
                            >
                              {imdbSearchSelected === result.imdbUrl && (
                                <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              )}
                            </div>
                            <span className="text-[11px] text-neutral-500">
                              {imdbSearchSelected === result.imdbUrl ? "Selected" : "Click to select"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-3">
              <button
                onClick={() => setImdbSearchOpen(false)}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleImdbSearchConfirm}
                disabled={!imdbSearchSelected || imdbSearchLoading}
                className="rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Use Selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Cover Image Section Component (for Media Detail Modal)
   ───────────────────────────────────────────────────────────────────────────── */
// Cover mode type for toggling between image and emoji
type CoverMode = "image" | "emoji";

type CoverSectionHandle = {
  getSavePayload: () => Record<string, unknown>;
  hasChanges: () => boolean;
  /** Programmatically set the cover URL (e.g. from IMDB preview image) */
  setCoverFromUrl: (url: string) => void;
};

const CoverImageSection = forwardRef<CoverSectionHandle, {
  metadata: MediaMetadata;
  availableCovers: CoverOption[];
  mediaSource: MediaSource;
  effectiveImdbUrl?: string;
  /** Called when the user uploads or selects an uploaded cover — parent can uncheck "Use cover art" */
  onCoverUploaded?: () => void;
}>(function CoverImageSection({
  metadata,
  availableCovers,
  mediaSource,
  effectiveImdbUrl,
  onCoverUploaded,
}, ref) {
  // Determine initial cover mode based on existing metadata
  const getInitialCoverMode = (): CoverMode => {
    if (metadata.coverEmoji) return "emoji";
    return "image";
  };

  const [coverMode, setCoverMode] = useState<CoverMode>(getInitialCoverMode);
  const [coverUrl, setCoverUrl] = useState(metadata.coverUrl || "");
  const [coverLocal, setCoverLocal] = useState(metadata.coverLocal || "");
  const [coverPath, setCoverPath] = useState(metadata.coverPath || "");
  const [coverEmoji, setCoverEmoji] = useState(metadata.coverEmoji || "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [localCovers, setLocalCovers] = useState<CoverOption[]>(availableCovers);
  const [fetchingImdbCover, setFetchingImdbCover] = useState(false);

  // Uploaded cover picker state
  const [showUploadedPicker, setShowUploadedPicker] = useState(false);
  const [refreshingCovers, setRefreshingCovers] = useState(false);

  // Refresh covers list from server/FTP
  const handleRefreshCovers = async () => {
    setRefreshingCovers(true);
    try {
      const res = await fetch(`/api/covers?source=${mediaSource}`, { cache: "no-store" });
      const data = await res.json();
      if (data.covers) {
        setLocalCovers((prev) => {
          // Merge: keep session-uploaded covers not yet on FTP
          const incoming = new Set((data.covers as CoverOption[]).map((c: CoverOption) => c.filename));
          const extras = prev.filter((c) => !incoming.has(c.filename));
          return [...(data.covers as CoverOption[]), ...extras];
        });
      }
    } catch (err) {
      console.error("[CoverSection] Failed to refresh covers:", err);
    } finally {
      setRefreshingCovers(false);
    }
  };

  // IMDB poster picker state
  const [showPosterPicker, setShowPosterPicker] = useState(false);
  const [posterPickerLoading, setPosterPickerLoading] = useState(false);
  const [posterPickerError, setPosterPickerError] = useState<string | null>(null);
  const [posterPickerResults, setPosterPickerResults] = useState<
    { url: string; thumbnail: string; caption?: string }[]
  >([]);
  const [posterPickerSelected, setPosterPickerSelected] = useState<string | null>(null);

  // Log IMDB URL visibility for cover section
  useEffect(() => {
    console.log("[IMDB Cover][CoverSection] IMDB URL state changed:", {
      effectiveImdbUrl: effectiveImdbUrl || "(empty)",
      "metadata.imdbUrl": metadata.imdbUrl || "(empty)",
      imdbUrlToUse: (effectiveImdbUrl || metadata.imdbUrl || "") || "(empty)",
      coverMode,
      buttonVisible: !!(effectiveImdbUrl || metadata.imdbUrl) && coverMode === "image",
    });
  }, [effectiveImdbUrl, metadata.imdbUrl, coverMode]);
  
  // Image browser state (for local mode)
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState("");
  const [browserEntries, setBrowserEntries] = useState<{ name: string; path: string; isDirectory: boolean }[]>([]);
  const [browserRoots, setBrowserRoots] = useState<{ name: string; path: string }[]>([]);
  const [browserParent, setBrowserParent] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);

  // Sync available covers when the prop changes (e.g. after API fetch completes)
  useEffect(() => {
    setLocalCovers((prev) => {
      // Merge: keep any covers we uploaded this session that aren't already in the list
      const incoming = new Set(availableCovers.map((c) => c.filename));
      const extras = prev.filter((c) => !incoming.has(c.filename));
      return [...availableCovers, ...extras];
    });
  }, [availableCovers]);

  // Sync state when metadata prop changes
  useEffect(() => {
    setCoverUrl(metadata.coverUrl || "");
    setCoverLocal(metadata.coverLocal || "");
    setCoverPath(metadata.coverPath || "");
    setCoverEmoji(metadata.coverEmoji || "");
    // Update mode based on what's set
    if (metadata.coverEmoji) {
      setCoverMode("emoji");
    } else if (metadata.coverUrl || metadata.coverLocal || metadata.coverPath) {
      setCoverMode("image");
    }
  }, [metadata.coverUrl, metadata.coverLocal, metadata.coverPath, metadata.coverEmoji]);

  // Get the resolved cover URL for preview (only for image mode)
  // For remote mode, coverLocal should resolve to remote server URL
  const resolvedCoverUrl = coverMode === "image" 
    ? (coverUrl 
        || (coverPath && mediaSource === "local" ? `/api/local-image?path=${encodeURIComponent(coverPath)}` : null)
        || (coverLocal ? (mediaSource === "remote" ? `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(coverLocal)}` : `/api/covers/${encodeURIComponent(coverLocal)}`) : null))
    : null;
  
  const hasImageChanges = 
    coverUrl !== (metadata.coverUrl || "") || 
    coverLocal !== (metadata.coverLocal || "") ||
    coverPath !== (metadata.coverPath || "");
  
  const hasEmojiChanges = coverEmoji !== (metadata.coverEmoji || "");
  
  const hasChanges = coverMode === "image" ? hasImageChanges : hasEmojiChanges;

  // Expose save payload and change detection to parent via ref
  useImperativeHandle(ref, () => ({
    getSavePayload: () => {
      if (coverMode === "image") {
        return {
          coverUrl: coverUrl.trim() || null,
          coverLocal: coverLocal || null,
          coverPath: coverPath || null,
          coverEmoji: null,
        };
      } else {
        return {
          coverUrl: null,
          coverLocal: null,
          coverPath: null,
          coverEmoji: coverEmoji.trim() || null,
        };
      }
    },
    hasChanges: () => hasChanges,
    setCoverFromUrl: (url: string) => {
      setCoverUrl(url);
      setCoverLocal("");
      setCoverPath("");
      setCoverMode("image");
    },
  }), [coverMode, coverUrl, coverLocal, coverPath, coverEmoji, hasChanges]);

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
      // Notify parent so it can uncheck "Use cover art"
      onCoverUploaded?.();
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
    if (coverMode === "image") {
      setCoverUrl("");
      setCoverLocal("");
      setCoverPath("");
    } else {
      setCoverEmoji("");
    }
  };

  // Fetch cover from IMDB
  const imdbUrlToUse = effectiveImdbUrl || metadata.imdbUrl || "";
  const handleFetchImdbCover = async () => {
    console.log("[IMDB Cover][CoverSection] === FETCH IMDB COVER START ===", { imdbUrlToUse });
    if (!imdbUrlToUse) {
      console.log("[IMDB Cover][CoverSection] No IMDB URL available, aborting");
      return;
    }
    
    setFetchingImdbCover(true);
    setError(null);
    setSuccess(null);

    try {
      console.log("[IMDB Cover][CoverSection] Calling /api/media-metadata/imdb-cover with:", imdbUrlToUse);
      const res = await fetch("/api/media-metadata/imdb-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imdbUrl: imdbUrlToUse }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("[IMDB Cover][CoverSection] API error:", res.status, data.error);
        throw new Error(data.error || "Failed to fetch IMDB cover");
      }

      if (data.coverUrl) {
        console.log("[IMDB Cover][CoverSection] Cover found:", { coverUrl: data.coverUrl.substring(0, 80) + "...", title: data.title });
        // Set the cover URL and clear other cover fields
        setCoverUrl(data.coverUrl);
        setCoverLocal("");
        setCoverPath("");
        setCoverMode("image");
        // Notify parent to uncheck "Use IMDB cover" checkbox since we manually fetched a cover
        onCoverUploaded?.();
        
        // Check if the IMDB title matches our metadata title
        const imdbTitle = data.title?.toLowerCase()?.replace(/\s*\(\d{4}\)\s*/g, "").trim() || "";
        const ourTitle = metadata.title?.toLowerCase()?.trim() || "";
        
        // Simple match check - if both titles exist and don't share at least 50% of words, warn
        if (imdbTitle && ourTitle) {
          const imdbWordsArr = imdbTitle.split(/\s+/).filter((w: string) => w.length > 2);
          const ourWordsArr = ourTitle.split(/\s+/).filter((w: string) => w.length > 2);
          const imdbWords = new Set<string>(imdbWordsArr);
          const ourWords = new Set<string>(ourWordsArr);
          const commonWords = imdbWordsArr.filter((w: string) => ourWords.has(w));
          const matchRatio = commonWords.length / Math.max(imdbWords.size, ourWords.size, 1);
          
          if (matchRatio < 0.5) {
            console.warn("[IMDB Cover][CoverSection] Title mismatch — IMDB:", data.title, "vs ours:", metadata.title, "ratio:", matchRatio);
            // Titles don't match well - show warning
            setError(`Warning: IMDB title "${data.title}" may not match "${metadata.title}". Verify this is correct before saving.`);
          } else {
            console.log("[IMDB Cover][CoverSection] Title match OK — ratio:", matchRatio);
            setSuccess(`Cover found for "${data.title}"`);
          }
        } else {
          setSuccess(`Cover found${data.title ? ` for "${data.title}"` : ""}`);
        }
      } else {
        console.log("[IMDB Cover][CoverSection] API returned no coverUrl");
        throw new Error("No cover image found on IMDB");
      }
    } catch (err) {
      console.error("[IMDB Cover][CoverSection] Fetch FAILED:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch IMDB cover");
    } finally {
      setFetchingImdbCover(false);
      console.log("[IMDB Cover][CoverSection] === FETCH IMDB COVER END ===");
    }
  };
  
  // Handle escape key to close poster picker modal (prevent parent modal from closing)
  useEffect(() => {
    if (!showPosterPicker) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setShowPosterPicker(false);
      }
    };
    // Use capture phase to intercept before the parent modal's handler
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [showPosterPicker]);

  // Open IMDB poster picker modal
  const handleOpenPosterPicker = async () => {
    if (!imdbUrlToUse) return;

    // Extract IMDB ID from URL
    const idMatch = imdbUrlToUse.match(/tt\d{7,8}/);
    if (!idMatch) {
      setError("Could not extract IMDB ID from URL");
      return;
    }

    setShowPosterPicker(true);
    setPosterPickerLoading(true);
    setPosterPickerError(null);
    setPosterPickerResults([]);
    setPosterPickerSelected(null);

    try {
      const res = await fetch(`/api/media-metadata/imdb-posters?id=${idMatch[0]}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to fetch posters");

      if (data.posters && data.posters.length > 0) {
        setPosterPickerResults(data.posters);
      } else {
        setPosterPickerError("No poster images found for this title on IMDB.");
      }
    } catch (err) {
      setPosterPickerError(err instanceof Error ? err.message : "Failed to fetch posters");
    } finally {
      setPosterPickerLoading(false);
    }
  };

  // Confirm poster picker selection
  const handlePosterPickerConfirm = () => {
    if (!posterPickerSelected) return;

    // Find the selected poster to get its full URL
    const selected = posterPickerResults.find((p) => p.url === posterPickerSelected);
    if (selected) {
      // Use the original full-res URL as the cover
      setCoverUrl(selected.url);
      setCoverLocal("");
      setCoverPath("");
      setCoverMode("image");
      setSuccess("Cover image selected from IMDB gallery");
      setError(null);
      // Notify parent to uncheck "Use IMDB cover" checkbox since we manually selected a different cover
      onCoverUploaded?.();
    }

    setShowPosterPicker(false);
  };

  // Switch between cover modes
  const handleModeSwitch = (mode: CoverMode) => {
    setCoverMode(mode);
    setError(null);
    setSuccess(null);
  };

  const isLocal = mediaSource === "local";

  return (
    <div className="border-t border-white/10 bg-neutral-800/30 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-neutral-500">Cover</h3>
        
        {/* Mode Toggle */}
        <div className="flex rounded-md border border-white/15 overflow-hidden">
          <button
            onClick={() => handleModeSwitch("image")}
            className={`px-2.5 py-1 text-xs font-medium transition ${
              coverMode === "image"
                ? "bg-emerald-500/20 text-emerald-300 border-r border-white/15"
                : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200 border-r border-white/15"
            }`}
          >
            Image
          </button>
          <button
            onClick={() => handleModeSwitch("emoji")}
            className={`px-2.5 py-1 text-xs font-medium transition ${
              coverMode === "emoji"
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
            }`}
          >
            Emoji
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Cover Preview */}
        <div className="flex-shrink-0">
          <div className="w-28 h-40 rounded-lg border border-white/15 bg-neutral-900 overflow-hidden">
            {coverMode === "emoji" && coverEmoji ? (
              /* Emoji Preview */
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
                <span className="text-6xl">{coverEmoji}</span>
              </div>
            ) : resolvedCoverUrl ? (
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
                {coverMode === "emoji" ? (
                  <>
                    <span className="text-3xl mb-1 opacity-30">😀</span>
                    <span className="text-xs">No emoji</span>
                  </>
                ) : (
                  <>
                    <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs">No cover</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Cover Controls */}
        <div className="flex-1 space-y-3">
          {coverMode === "emoji" ? (
            /* Emoji Mode: Input an emoji */
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Select Emoji</label>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={coverEmoji}
                  onChange={(e) => {
                    // Allow only the first emoji/character for simplicity
                    const value = e.target.value;
                    // Get first grapheme (handles multi-codepoint emojis)
                    const segments = [...new Intl.Segmenter().segment(value)];
                    const firstEmoji = segments[0]?.segment || "";
                    setCoverEmoji(firstEmoji);
                  }}
                  placeholder="🎬"
                  className="w-20 h-12 rounded-md border border-white/15 bg-white/5 text-3xl text-center placeholder:text-neutral-600 outline-none focus:border-emerald-300"
                />
                <span className="text-xs text-neutral-500">Enter or paste an emoji</span>
              </div>
              
              {/* Quick emoji suggestions */}
              <div className="mt-3">
                <label className="block text-xs text-neutral-500 mb-2">Quick Pick</label>
                <div className="flex flex-wrap gap-1.5">
                  {["🎬", "🎥", "📺", "🎭", "🎪", "🎤", "🎸", "⚽", "🏀", "🎾", "🏈", "📖", "🎵", "🎶", "🌟", "💫", "🔥", "❤️", "🎁", "🎄"].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setCoverEmoji(emoji)}
                      className={`w-9 h-9 rounded-md text-xl hover:bg-white/10 transition ${
                        coverEmoji === emoji 
                          ? "bg-emerald-500/20 border border-emerald-400/40" 
                          : "bg-white/5 border border-white/10"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : isLocal ? (
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
            /* Remote Mode: Upload or select from uploaded */
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Upload Cover</label>
              <div className="flex gap-2">
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
                <button
                  type="button"
                  onClick={() => {
                    const opening = !showUploadedPicker;
                    setShowUploadedPicker(opening);
                    // Auto-refresh when opening the picker
                    if (opening) void handleRefreshCovers();
                  }}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition flex items-center gap-2 ${
                    showUploadedPicker
                      ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-300"
                      : "border-white/20 bg-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  Select from Uploaded
                </button>
              </div>

              {/* Uploaded covers picker grid */}
              {showUploadedPicker && (
                <div className="mt-2 rounded-md border border-white/15 bg-neutral-900/80 p-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-neutral-400">
                      {refreshingCovers ? "Loading covers from server..." : `${localCovers.length} uploaded cover${localCovers.length !== 1 ? "s" : ""}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRefreshCovers()}
                        disabled={refreshingCovers}
                        className="text-xs text-neutral-500 hover:text-neutral-300 transition flex items-center gap-1 disabled:opacity-50"
                        title="Refresh covers list from server"
                      >
                        <svg className={`w-3 h-3 ${refreshingCovers ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowUploadedPicker(false)}
                        className="text-xs text-neutral-500 hover:text-neutral-300 transition"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  {refreshingCovers && localCovers.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                      <div className="h-5 w-5 border-2 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
                      <span className="ml-2 text-xs text-neutral-400">Fetching covers...</span>
                    </div>
                  ) : localCovers.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-xs text-neutral-500">No uploaded covers found on the server.</p>
                      <p className="text-xs text-neutral-600 mt-1">Upload an image above or add JPG files to the covers/ folder on FTP.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                      {localCovers.map((cover) => {
                        const thumbUrl = mediaSource === "remote"
                          ? `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(cover.filename)}`
                          : `/api/covers/${encodeURIComponent(cover.filename)}`;
                        const isSelected = coverLocal === cover.filename;
                        return (
                          <button
                            key={cover.filename}
                            type="button"
                            onClick={() => {
                              setCoverLocal(cover.filename);
                              setCoverUrl("");
                              setCoverPath("");
                              setShowUploadedPicker(false);
                              onCoverUploaded?.();
                            }}
                            className={`relative rounded-md overflow-hidden border-2 transition aspect-[7/10] group ${
                              isSelected
                                ? "border-emerald-400 ring-1 ring-emerald-400/30"
                                : "border-white/10 hover:border-white/30"
                            }`}
                            title={cover.filename}
                          >
                            <img
                              src={thumbUrl}
                              alt={cover.filename}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                            {isSelected && (
                              <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                                <svg className="w-5 h-5 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition">
                              <p className="text-[9px] text-neutral-300 truncate">{cover.filename}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

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

          {/* Cover action buttons (non-save actions only) */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {((coverMode === "image" && (coverUrl || coverLocal || coverPath)) || 
              (coverMode === "emoji" && coverEmoji)) && (
              <button
                onClick={handleClear}
                className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-400 hover:bg-white/10 hover:text-neutral-200 transition"
              >
                Clear Cover
              </button>
            )}
            {/* IMDB Cover Button - appears when imdbUrl is set (from saved metadata or current edit) */}
            {imdbUrlToUse && coverMode === "image" && (
              <>
                <button
                  onClick={handleFetchImdbCover}
                  disabled={fetchingImdbCover}
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 transition disabled:opacity-50 flex items-center gap-1.5"
                  title="Fetch cover image from IMDB"
                >
                  {fetchingImdbCover ? (
                    <>
                      <div className="h-3 w-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8 17v-2h2l3.6-3.6 2 2L12 17h-2v2H8v-2z"/>
                      </svg>
                      Use IMDB Cover
                    </>
                  )}
                </button>
                <button
                  onClick={handleOpenPosterPicker}
                  disabled={posterPickerLoading}
                  className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition disabled:opacity-50 flex items-center gap-1.5"
                  title="Browse alternative covers from IMDB"
                >
                  {posterPickerLoading ? (
                    <>
                      <div className="h-3 w-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                      Choose Different Cover
                    </>
                  )}
                </button>
              </>
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

      {/* IMDB Poster Picker Modal */}
      {showPosterPicker && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPosterPicker(false); }}
        >
          <div className="relative w-full max-w-2xl mx-4 rounded-xl border border-white/15 bg-neutral-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-neutral-100">Choose Cover from IMDB</h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Select an alternative poster or image from IMDB&apos;s gallery
                </p>
              </div>
              <button
                onClick={() => setShowPosterPicker(false)}
                className="rounded-md p-1 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-200"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
              {posterPickerLoading && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                  <p className="text-sm text-neutral-400">Loading images from IMDB...</p>
                </div>
              )}

              {posterPickerError && !posterPickerLoading && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="text-sm text-red-300">{posterPickerError}</p>
                </div>
              )}

              {!posterPickerLoading && !posterPickerError && posterPickerResults.length > 0 && (
                <div>
                  <p className="text-xs text-neutral-500 mb-3">
                    {posterPickerResults.length} image{posterPickerResults.length !== 1 ? "s" : ""} available. Click to select:
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {posterPickerResults.map((poster, idx) => (
                      <button
                        key={poster.url}
                        onClick={() => setPosterPickerSelected(poster.url)}
                        className={`group relative rounded-lg border-2 overflow-hidden transition-all ${
                          posterPickerSelected === poster.url
                            ? "border-blue-400 ring-2 ring-blue-400/30 scale-[1.02]"
                            : "border-white/10 hover:border-white/30 hover:scale-[1.01]"
                        }`}
                      >
                        <div className="aspect-[2/3] bg-neutral-800">
                          <img
                            src={poster.thumbnail}
                            alt={poster.caption || `Image ${idx + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                        {/* Selection indicator */}
                        {posterPickerSelected === poster.url && (
                          <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center shadow-lg">
                            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                        {/* Caption tooltip */}
                        {poster.caption && (
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 opacity-0 group-hover:opacity-100 transition">
                            <p className="text-[10px] text-neutral-200 line-clamp-2">{poster.caption}</p>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!posterPickerLoading && !posterPickerError && posterPickerResults.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-neutral-500">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">No images found on IMDB for this title.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
              <div className="text-xs text-neutral-500">
                {posterPickerSelected && (
                  <span className="text-blue-300">1 image selected</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowPosterPicker(false)}
                  className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePosterPickerConfirm}
                  disabled={!posterPickerSelected}
                  className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Use Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

