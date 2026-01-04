"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

type MediaItem = {
  relPath: string;
  durationSeconds?: number;
  format?: string;
  supported?: boolean;
  supportedViaCompanion?: boolean;
  title?: string;
};

/* ─────────────────────────────────────────────────────────────────────────────
   Media Detail Modal Component
   ───────────────────────────────────────────────────────────────────────────── */
function MediaDetailModal({
  item,
  mediaSource,
  onClose,
}: {
  item: MediaItem;
  mediaSource: MediaSource;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.durationSeconds || 0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-neutral-500 mb-1">Format</p>
              <p className="text-sm font-medium text-neutral-200 uppercase">
                {item.format || "Unknown"}
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
                  item.supported
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "bg-amber-500/20 text-amber-200"
                }`}
              >
                {item.supported
                  ? item.supportedViaCompanion
                    ? "Companion"
                    : "Native"
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
        </div>
      </div>
    </div>
  );
}

type RemoteFileStatus = {
  file: string;
  url: string;
  status: "checking" | "found" | "missing" | "error";
  mediaCount?: number;
  channelCount?: number;
  scheduleChannelCount?: number;
  error?: string;
};

export default function SourceAdminPage() {
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [pendingSource, setPendingSource] = useState<MediaSource>("local");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushingAll, setPushingAll] = useState(false);
  const [syncingLocalJson, setSyncingLocalJson] = useState(false);
  const [files, setFiles] = useState<MediaItem[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaRefreshToken, setMediaRefreshToken] = useState(0);
  const [forceMediaRefresh, setForceMediaRefresh] = useState(false);
  const [remoteStatuses, setRemoteStatuses] = useState<RemoteFileStatus[]>([]);
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [pushingFile, setPushingFile] = useState<string | null>(null);
  const [scanningRemote, setScanningRemote] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [supportedFilter, setSupportedFilter] = useState<"all" | "supported" | "unsupported">(
    "all",
  );

  // Load and sync media source preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      if (stored === "remote" || stored === "local") {
        setMediaSource(stored);
        setPendingSource(stored);
      }
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(MEDIA_SOURCE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(MEDIA_SOURCE_EVENT, sync);
    };
  }, []);

  // Load channels list
  useEffect(() => {
    const loadChannels = async () => {
      try {
        const res = await fetch(`/api/channels?source=local`);
        if (res.ok) {
          const data = await res.json();
          setChannels(data.channels || []);
        }
      } catch {
        // ignore
      }
    };
    void loadChannels();
  }, []);

  // Load media list for selected source
  useEffect(() => {
    let cancelled = false;
    const shouldForceRefresh = forceMediaRefresh;
    if (forceMediaRefresh) setForceMediaRefresh(false);
    setLoadingMedia(true);
    setError(null);

    const load = async () => {
      try {
        let filesJson: { items?: MediaItem[] } = {};
        if (mediaSource === "remote") {
          const manifestRes = await fetch(
            `/api/media-index?base=${encodeURIComponent(REMOTE_MEDIA_BASE)}&t=${Date.now()}`,
            { cache: "no-store" },
          );
          if (!manifestRes.ok) {
            const text = await manifestRes.text();
            throw new Error(text || "Failed to load remote manifest");
          }
          filesJson = await manifestRes.json();
        } else {
          const params = new URLSearchParams();
          if (shouldForceRefresh) params.set("refresh", "1");
          params.set("t", String(Date.now()));
          const filesRes = await fetch(
            `/api/media-files?${params.toString()}`,
            { cache: "no-store" },
          );
          filesJson = await filesRes.json();
        }
        if (!cancelled) {
          setFiles(filesJson.items || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load media");
          setFiles([]);
        }
      } finally {
        if (!cancelled) setLoadingMedia(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [mediaSource, mediaRefreshToken, forceMediaRefresh]);

  const saveSource = () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      setMediaSource(pendingSource);
      if (typeof window !== "undefined") {
        localStorage.setItem(MEDIA_SOURCE_KEY, pendingSource);
        window.dispatchEvent(new Event(MEDIA_SOURCE_EVENT));
      }
      setMessage(
        `Media source set to ${pendingSource === "remote" ? "Remote" : "Local"}${
          pendingSource === "remote" ? ` (${REMOTE_MEDIA_BASE})` : ""
        }`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save source");
    } finally {
      setSaving(false);
    }
  };

  const pushEverythingToRemote = async () => {
    setPushingAll(true);
    setMessage(null);
    setError(null);
    try {
      // Push media index
      const manifestRes = await fetch("/api/media-index/push", { method: "POST" });
      const manifestData = await manifestRes.json();
      if (!manifestRes.ok || !manifestData?.success) {
        throw new Error(manifestData?.message || "Failed to upload media-index.json");
      }

      // Push channels
      const channelsRes = await fetch("/api/channels/push", { method: "POST" });
      const channelsData = await channelsRes.json();
      if (!channelsRes.ok || !channelsData?.success) {
        throw new Error(channelsData?.message || "Failed to upload channels.json");
      }

      // Push schedule (single file with all channels)
      const scheduleRes = await fetch("/api/schedule/push", { method: "POST" });
      const scheduleData = await scheduleRes.json();
      if (!scheduleRes.ok || !scheduleData?.success) {
        throw new Error(scheduleData?.message || "Failed to upload schedule.json");
      }

      setMessage("Pushed to remote: media-index.json, channels.json, schedule.json");
      // Refresh status after push
      if (mediaSource === "remote") {
        void checkRemoteFiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushingAll(false);
    }
  };

  const syncLocalJson = async () => {
    setSyncingLocalJson(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/media-index/local", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Sync failed");
      }
      setMessage(data.message || "Saved media-index.json");
      // Refresh the media list after syncing
      refreshMediaList({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingLocalJson(false);
    }
  };

  const refreshMediaList = (opts?: { force?: boolean }) => {
    if (opts?.force) setForceMediaRefresh(true);
    setMediaRefreshToken((token) => token + 1);
  };

  // Scan remote media folder via FTP and regenerate media-index.json
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
      setMessage(data.message || `Scanned remote and found ${data.count} files`);
      // Refresh the media list and status after scanning
      refreshMediaList();
      void checkRemoteFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanningRemote(false);
    }
  };

  // Check remote JSON files status via server-side API (avoids CORS issues)
  const checkRemoteFiles = async () => {
    setCheckingRemote(true);
    
    // Initialize with checking status
    setRemoteStatuses([
      { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "checking" },
      { file: "channels.json", url: `${REMOTE_MEDIA_BASE}channels.json`, status: "checking" },
      { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "checking" },
    ]);

    try {
      const res = await fetch("/api/remote-status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRemoteStatuses(data.files || []);
      } else {
        // If API fails, mark all as error
        setRemoteStatuses([
          { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "error", error: "API error" },
          { file: "channels.json", url: `${REMOTE_MEDIA_BASE}channels.json`, status: "error", error: "API error" },
          { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "error", error: "API error" },
        ]);
      }
    } catch (err) {
      setRemoteStatuses([
        { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "error", error: err instanceof Error ? err.message : "Network error" },
        { file: "channels.json", url: `${REMOTE_MEDIA_BASE}channels.json`, status: "error", error: err instanceof Error ? err.message : "Network error" },
        { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "error", error: err instanceof Error ? err.message : "Network error" },
      ]);
    } finally {
      setCheckingRemote(false);
    }
  };

  // Check remote files when switching to remote or on refresh
  useEffect(() => {
    if (mediaSource === "remote") {
      void checkRemoteFiles();
    }
  }, [mediaSource, mediaRefreshToken]);

  const availableFormats = useMemo(() => {
    const formats = new Set<string>();
    files.forEach((file) => {
      if (file.format) {
        formats.add(file.format.toUpperCase());
      }
    });
    return Array.from(formats).sort();
  }, [files]);

  const filteredFiles = useMemo(() => {
    return files.filter((file) => {
      if (formatFilter !== "all" && (file.format || "").toUpperCase() !== formatFilter) {
        return false;
      }
      if (supportedFilter === "supported" && !file.supported) return false;
      if (supportedFilter === "unsupported" && file.supported) return false;
      return true;
    });
  }, [files, formatFilter, supportedFilter]);

  // Push a single file to remote
  const pushSingleFile = async (file: string) => {
    setPushingFile(file);
    setMessage(null);
    setError(null);
    try {
      if (file === "media-index.json") {
        const res = await fetch("/api/media-index/push", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || "Failed to upload media-index.json");
        }
      } else if (file === "channels.json") {
        const res = await fetch("/api/channels/push", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || "Failed to upload channels.json");
        }
      } else if (file === "schedule.json") {
        const res = await fetch("/api/schedule/push", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || "Failed to upload schedule.json");
        }
      }
      setMessage(`Pushed ${file} to remote`);
      // Refresh the status after pushing
      void checkRemoteFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushingFile(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-neutral-50">Media Source</h1>
        <p className="text-sm text-neutral-400">
          Switch between local files and remote CDN. Each source has its own media catalog and schedules.
        </p>
      </div>

      {/* Source Selection */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">Active Source</p>
            <p className="text-lg font-semibold text-neutral-50">
              {mediaSource === "remote" ? "Remote" : "Local"}
            </p>
            {mediaSource === "remote" && (
              <p className="text-xs text-neutral-400 font-mono">{REMOTE_MEDIA_BASE}</p>
            )}
          </div>
          <div
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              mediaSource === "remote"
                ? "bg-blue-500/20 text-blue-200"
                : "bg-emerald-500/20 text-emerald-200"
            }`}
          >
            {mediaSource === "remote" ? "CDN" : "Local Files"}
          </div>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3 cursor-pointer hover:bg-white/10 transition">
            <input
              type="radio"
              name="media-source"
              value="local"
              checked={pendingSource === "local"}
              onChange={() => setPendingSource("local")}
              className="h-4 w-4 mt-0.5"
            />
            <div>
              <p className="font-semibold text-neutral-100">Local</p>
              <p className="text-xs text-neutral-400">
                Media from <code className="bg-white/10 px-1 rounded">./media</code>, config from{" "}
                <code className="bg-white/10 px-1 rounded">data/</code>
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3 cursor-pointer hover:bg-white/10 transition">
            <input
              type="radio"
              name="media-source"
              value="remote"
              checked={pendingSource === "remote"}
              onChange={() => setPendingSource("remote")}
              className="h-4 w-4 mt-0.5"
            />
            <div>
              <p className="font-semibold text-neutral-100">Remote</p>
              <p className="text-xs text-neutral-400">
                Media + schedules from <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code>
              </p>
            </div>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={saveSource}
            disabled={saving || pendingSource === mediaSource}
            className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Apply Source"}
          </button>
          {pendingSource !== mediaSource && (
            <button
              onClick={() => setPendingSource(mediaSource)}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Push to Remote */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
        <h2 className="text-sm font-semibold text-neutral-100 mb-1">Push to Remote</h2>
        <p className="text-xs text-neutral-400 mb-4">
          Upload local data to your remote CDN via FTP. This syncs your local schedules and media catalog to the remote source.
        </p>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-4">
          <p className="text-xs text-neutral-400 mb-2">3 JSON files per media source:</p>
          <div className="font-mono text-xs text-neutral-300 space-y-1">
            <p>├── media-index.json <span className="text-neutral-500">← media file index</span></p>
            <p>├── channels.json <span className="text-neutral-500">← channel list</span></p>
            <p>├── schedule.json <span className="text-neutral-500">← all channel schedules</span></p>
            <p>└── *.mp4, *.mkv, ... <span className="text-neutral-500">← media files</span></p>
          </div>
        </div>

        <button
          onClick={() => void pushEverythingToRemote()}
          disabled={pushingAll}
          className="rounded-md border border-blue-300/50 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
        >
          {pushingAll ? "Pushing…" : "Push to Remote"}
        </button>

        {(message || error) && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              message
                ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                : "border-amber-300/40 bg-amber-500/10 text-amber-100"
            }`}
          >
            {message || error}
          </div>
        )}
      </div>

      {/* Remote Status Check */}
      {mediaSource === "remote" && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-neutral-100">Remote File Status</h3>
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-200">
                CDN
              </span>
            </div>
            <button
              onClick={() => void checkRemoteFiles()}
              disabled={checkingRemote}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
            >
              {checkingRemote ? "Checking…" : "Refresh Status"}
            </button>
          </div>
          <p className="mb-3 text-xs text-neutral-400">
            Checking required JSON files at <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code>
          </p>
          
          {remoteStatuses.length === 0 && !checkingRemote ? (
            <p className="text-sm text-neutral-400">Click &quot;Refresh Status&quot; to check remote files.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-white/5">
              <table className="min-w-full text-sm text-left">
                <thead className="bg-white/5 text-neutral-200">
                  <tr>
                    <th className="px-3 py-2 font-semibold">File</th>
                    <th className="px-3 py-2 font-semibold w-32 text-center">Status</th>
                    <th className="px-3 py-2 font-semibold text-left">Details</th>
                    <th className="px-3 py-2 font-semibold w-24 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-neutral-950/40 text-neutral-100">
                  {remoteStatuses.map((item) => (
                    <tr key={item.file}>
                      <td className="px-3 py-2">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-300 hover:text-blue-200 hover:underline"
                        >
                          {item.file}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
                            item.status === "found"
                              ? "bg-emerald-500/20 text-emerald-100"
                              : item.status === "missing"
                              ? "bg-red-500/20 text-red-100"
                              : item.status === "checking"
                              ? "bg-neutral-500/20 text-neutral-300"
                              : "bg-amber-500/20 text-amber-100"
                          }`}
                        >
                          {item.status === "checking" && (
                            <span className="inline-block w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                          )}
                          {item.status === "found" && "✓ Found"}
                          {item.status === "missing" && "✕ Missing"}
                          {item.status === "checking" && "Checking"}
                          {item.status === "error" && "⚠ Error"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-neutral-400 text-xs">
                        {item.status === "found" && item.mediaCount !== undefined && (
                          <span>{item.mediaCount} media file{item.mediaCount === 1 ? "" : "s"}</span>
                        )}
                        {item.status === "found" && item.channelCount !== undefined && (
                          <span>{item.channelCount} channel{item.channelCount === 1 ? "" : "s"}</span>
                        )}
                        {item.status === "found" && item.scheduleChannelCount !== undefined && (
                          <span>{item.scheduleChannelCount} channel schedule{item.scheduleChannelCount === 1 ? "" : "s"}</span>
                        )}
                        {item.status === "missing" && (
                          <span className="text-red-300">Not found on remote</span>
                        )}
                        {item.status === "error" && (
                          <span className="text-amber-300">{item.error}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.status === "missing" && (
                          <button
                            onClick={() => void pushSingleFile(item.file)}
                            disabled={pushingFile !== null}
                            className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                          >
                            {pushingFile === item.file ? "Pushing…" : "Push"}
                          </button>
                        )}
                        {item.status === "found" && (
                          <button
                            onClick={() => void pushSingleFile(item.file)}
                            disabled={pushingFile !== null}
                            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-300 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
                            title="Update this file on remote"
                          >
                            {pushingFile === item.file ? "Pushing…" : "Update"}
                          </button>
                        )}
                        {item.status === "checking" && (
                          <span className="text-xs text-neutral-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {/* Summary */}
          {remoteStatuses.length > 0 && !checkingRemote && (
            <div className="mt-3 flex items-center gap-4 text-xs">
              <span className="text-emerald-300">
                ✓ {remoteStatuses.filter((s) => s.status === "found").length} found
              </span>
              {remoteStatuses.filter((s) => s.status === "missing").length > 0 && (
                <span className="text-red-300">
                  ✕ {remoteStatuses.filter((s) => s.status === "missing").length} missing
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Media List (both local and remote) */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-neutral-100">
              {mediaSource === "remote" ? "Remote Media" : "Local Media"}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                mediaSource === "remote"
                  ? "bg-blue-500/20 text-blue-200"
                  : "bg-emerald-500/20 text-emerald-200"
              }`}
            >
              {mediaSource === "remote" ? "CDN" : "Local"}
            </span>
            <span className="text-xs text-neutral-400">
              {filteredFiles.length} file{filteredFiles.length === 1 ? "" : "s"} showing
              {filteredFiles.length !== files.length
                ? ` (of ${files.length} total)`
                : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshMediaList()}
              disabled={loadingMedia}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
            >
              {loadingMedia ? "Loading…" : "Refresh"}
            </button>
            {mediaSource === "local" && (
              <button
                onClick={() => void syncLocalJson()}
                disabled={syncingLocalJson || loadingMedia}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                title="Rescan media folder and save to data/media-index.json"
              >
                {syncingLocalJson ? "Syncing…" : "Rescan & Save"}
              </button>
            )}
            {mediaSource === "remote" && (
              <button
                onClick={() => void scanRemoteMedia()}
                disabled={scanningRemote || loadingMedia}
                className="rounded-md border border-blue-300/50 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                title="Scan remote folder via FTP and regenerate media-index.json"
              >
                {scanningRemote ? "Scanning…" : "Rescan Remote"}
              </button>
            )}
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Format</label>
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-emerald-300 focus:bg-white/10"
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
            <label className="text-xs text-neutral-400">Supported</label>
            <select
              value={supportedFilter}
              onChange={(e) => setSupportedFilter(e.target.value as typeof supportedFilter)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-emerald-300 focus:bg-white/10"
            >
              <option value="all">All</option>
              <option value="supported">Supported</option>
              <option value="unsupported">Unsupported</option>
            </select>
          </div>
        </div>
        <div className="mb-3 text-xs text-neutral-400">
          {mediaSource === "local" ? (
            <>
              <p>Source: <code className="bg-white/10 px-1 rounded">./media</code> folder</p>
              <p>Index: <code className="bg-white/10 px-1 rounded">data/media-index.json</code></p>
            </>
          ) : (
            <>
              <p>Source: <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code></p>
              <p>Index: <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}media-index.json</code></p>
            </>
          )}
        </div>
        {loadingMedia ? (
          <p className="text-sm text-neutral-300">Loading media…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-neutral-300">
            {mediaSource === "remote"
              ? "No media found on remote. Check that media-index.json exists."
              : "No media found. Add files to ./media and click \"Rescan & Save\"."}
          </p>
        ) : filteredFiles.length === 0 ? (
          <p className="text-sm text-neutral-300">
            No media match the selected filters.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/5">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-white/5 text-neutral-200">
                <tr>
                  <th className="px-3 py-2 font-semibold">File</th>
                  <th className="px-3 py-2 font-semibold w-24 text-left">Format</th>
                  <th className="px-3 py-2 font-semibold w-28 text-left">Supported</th>
                  <th className="px-3 py-2 font-semibold w-28 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/40 text-neutral-100">
                {filteredFiles.map((file) => (
                  <tr key={file.relPath} className="hover:bg-white/5 transition-colors">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setSelectedMedia(file)}
                        className="text-left break-all text-blue-300 hover:text-blue-200 hover:underline transition cursor-pointer"
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
                          file.supported
                            ? "bg-emerald-500/20 text-emerald-100"
                            : "bg-amber-500/20 text-amber-100"
                        }`}
                      >
                        {file.supported
                          ? file.supportedViaCompanion
                            ? "Yes (companion)"
                            : "Yes"
                          : "No"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-neutral-200">
                      {formatDuration(file.durationSeconds || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Media Detail Modal */}
      {selectedMedia && (
        <MediaDetailModal
          item={selectedMedia}
          mediaSource={mediaSource}
          onClose={() => setSelectedMedia(null)}
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


