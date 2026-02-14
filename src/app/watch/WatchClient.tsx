"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  type MediaSource,
  REMOTE_MEDIA_BASE,
} from "@/constants/media";
import { Modal, ModalTitle, ModalFooter, ModalButton } from "@/components/Modal";
import {
  trackVideoStart,
  trackFullscreenToggle,
  trackMuteToggle,
  trackCrtToggle,
  trackVideoError,
  trackWatchDuration,
  trackShare,
  setUserProperties,
} from "@/lib/analytics";

const MUTED_PREF_KEY = "player-muted-default";
const CRT_PREF_KEY = "player-crt-default";
const VOLUME_PREF_KEY = "player-volume-default";

type MediaMetadata = {
  title?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: "film" | "tv" | "documentary" | "sports" | "concert" | "other" | null;
  season?: number | null;
  episode?: number | null;
  coverUrl?: string | null;
  coverLocal?: string | null;
  coverPath?: string | null;
  tags?: string[] | null;
};

interface WatchClientProps {
  initialFile?: string;
  initialSource?: string;
}

export default function WatchClient({ initialFile, initialSource }: WatchClientProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Media state
  const [filePath, setFilePath] = useState<string | null>(initialFile ?? null);
  const [mediaSource, setMediaSource] = useState<MediaSource>(
    initialSource === "local" ? "local" : "remote",
  );
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);

  // Player preferences
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(true);
  const [volume, setVolume] = useState(1.0);
  const volumeRef = useRef(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(true);

  // Volume overlay
  const [showVolumeOverlay, setShowVolumeOverlay] = useState(false);
  const volumeOverlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Info modal
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoMetadata, setInfoMetadata] = useState<MediaMetadata | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  // Share
  const [shareCopied, setShareCopied] = useState(false);

  // Seeking via scrub bar
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);

  // ── Build the video source URL ──────────────────────────────────────
  const buildSrc = useCallback(
    (file: string, source: MediaSource): string => {
      if (source === "remote") {
        return new URL(file, REMOTE_MEDIA_BASE).toString();
      }
      return `/api/media?file=${encodeURIComponent(file)}`;
    },
    [],
  );

  // ── Volume overlay helper ───────────────────────────────────────────
  const triggerVolumeOverlay = useCallback((isMuted: boolean) => {
    if (volumeOverlayTimeoutRef.current) {
      clearTimeout(volumeOverlayTimeoutRef.current);
    }
    setShowVolumeOverlay(true);
    if (!isMuted) {
      volumeOverlayTimeoutRef.current = setTimeout(() => {
        setShowVolumeOverlay(false);
      }, 1500);
    }
  }, []);

  // ── Cleanup timeouts ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (volumeOverlayTimeoutRef.current) {
        clearTimeout(volumeOverlayTimeoutRef.current);
      }
    };
  }, []);

  // ── Load media source preference ────────────────────────────────────
  useEffect(() => {
    // If an explicit source was provided via URL, respect it
    if (initialSource === "local" || initialSource === "remote") return;
    if (typeof window === "undefined") return;
    const syncSource = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      const source = stored === "local" ? "local" : "remote";
      setMediaSource(source);
      setUserProperties({ media_source: source });
    };
    syncSource();
    window.addEventListener("storage", syncSource);
    window.addEventListener(MEDIA_SOURCE_EVENT, syncSource);
    return () => {
      window.removeEventListener("storage", syncSource);
      window.removeEventListener(MEDIA_SOURCE_EVENT, syncSource);
    };
  }, [initialSource]);

  // ── Load muted preference ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(MUTED_PREF_KEY);
    if (stored === "true" || stored === "false") {
      setMuted(stored === "true");
    } else {
      localStorage.setItem(MUTED_PREF_KEY, "true");
      setMuted(true);
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(MUTED_PREF_KEY, muted ? "true" : "false");
  }, [muted]);

  // ── Load CRT preference ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(CRT_PREF_KEY);
    if (stored === "true" || stored === "false") {
      setCrtEnabled(stored === "true");
    } else {
      localStorage.setItem(CRT_PREF_KEY, "true");
      setCrtEnabled(true);
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CRT_PREF_KEY, crtEnabled ? "true" : "false");
    setUserProperties({ crt_enabled: crtEnabled });
  }, [crtEnabled]);

  // ── Load volume preference ──────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(VOLUME_PREF_KEY);
    if (stored !== null) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        setVolume(parsed);
      }
    } else {
      localStorage.setItem(VOLUME_PREF_KEY, "1.0");
      setVolume(1.0);
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(VOLUME_PREF_KEY, volume.toString());
  }, [volume]);

  // ── Show volume overlay on changes ──────────────────────────────────
  useEffect(() => {
    triggerVolumeOverlay(muted);
  }, [volume, muted, triggerVolumeOverlay]);

  // ── Track watch duration on unload ──────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      const video = videoRef.current;
      if (filePath && video && video.currentTime > 0) {
        trackWatchDuration({
          videoTitle: infoMetadata?.title || filePath,
          videoPath: filePath,
          channelId: "watch",
          watchedSeconds: video.currentTime,
          totalDurationSeconds: video.duration || 0,
        });
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [filePath, infoMetadata]);

  // ── Wire up the video element ───────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !filePath) return;

    setError(null);
    setIsVideoLoading(true);
    setHasStarted(false);

    const src = buildSrc(filePath, mediaSource);

    const handleLoadedMetadata = () => {
      video.muted = mutedRef.current;
      video.volume = volumeRef.current;
      setDuration(video.duration || 0);
      // Start from the beginning
      video.currentTime = 0;
      console.log("[watch] media loaded", { filePath, duration: video.duration });
    };

    const handleCanPlay = () => {
      setIsVideoLoading(false);
      if (!hasStarted) {
        video
          .play()
          .then(() => {
            setHasStarted(true);
            setIsPlaying(true);
            trackVideoStart({
              videoTitle: infoMetadata?.title || filePath,
              videoPath: filePath,
              channelId: "watch",
              startOffset: 0,
            });
          })
          .catch((err) => {
            console.warn("[watch] autoplay failed, retrying muted", err);
            // Try muted autoplay without changing user's saved preference
            video.muted = true;
            video
              .play()
              .then(() => {
                setHasStarted(true);
                setIsPlaying(true);
                // Restore user's actual mute preference after successful play
                video.muted = mutedRef.current;
              })
              .catch(() => {
                // Restore mute preference even on failure
                video.muted = mutedRef.current;
                // User will need to click play
                setIsPlaying(false);
              });
          });
      }
    };

    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(video.currentTime);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsVideoLoading(true);
    const handlePlaying = () => setIsVideoLoading(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(video.duration || 0);
    };

    const handleError = () => {
      console.error("[watch] video error", video.error);
      setError(video.error?.message || "Failed to load video");
      setIsVideoLoading(false);
      trackVideoError({
        videoPath: filePath,
        channelId: "watch",
        errorType: "load_failed",
        errorMessage: video.error?.message,
      });
    };

    video.src = src;
    video.preload = "auto";
    video.controls = false;
    video.load();

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, mediaSource]);

  // ── Sync muted / volume to video element ────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    mutedRef.current = muted;
    video.muted = muted;
  }, [muted]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    volumeRef.current = volume;
    video.volume = volume;
  }, [volume]);

  // ── Fetch metadata ──────────────────────────────────────────────────
  useEffect(() => {
    if (!filePath) {
      setInfoMetadata(null);
      return;
    }
    setInfoLoading(true);
    fetch(
      `/api/media-metadata?file=${encodeURIComponent(filePath)}&source=${mediaSource}`,
    )
      .then((res) => res.json())
      .then((data) => {
        setInfoMetadata(data.metadata || {});
        setInfoLoading(false);
      })
      .catch(() => {
        setInfoMetadata({});
        setInfoLoading(false);
      });
  }, [filePath, mediaSource]);

  // ── Fullscreen handling ─────────────────────────────────────────────
  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (active) videoRef.current?.focus();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitExitFullscreen?: () => void;
          webkitDisplayingFullscreen?: boolean;
        })
      | null;
    const handleWebkitBegin = () => setIsFullscreen(true);
    const handleWebkitEnd = () => setIsFullscreen(false);
    if (video) {
      video.addEventListener("webkitbeginfullscreen", handleWebkitBegin);
      video.addEventListener("webkitendfullscreen", handleWebkitEnd);
    }
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (video) {
        video.removeEventListener("webkitbeginfullscreen", handleWebkitBegin);
        video.removeEventListener("webkitendfullscreen", handleWebkitEnd);
      }
    };
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        (target as HTMLElement | null)?.isContentEditable;
      if (isTyping) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key?.toLowerCase();
      if (!key) return;

      // Space bar: toggle play/pause
      if (key === " ") {
        event.preventDefault();
        togglePlayPause();
        return;
      }

      if (key === "m") {
        event.preventDefault();
        setMuted((prev) => {
          trackMuteToggle(!prev);
          return !prev;
        });
        return;
      }

      if (key === "c") {
        event.preventDefault();
        setCrtEnabled((prev) => {
          trackCrtToggle(!prev);
          return !prev;
        });
        return;
      }

      if (key === "f") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }

      if (key === "i") {
        event.preventDefault();
        if (!showInfoModal && filePath) {
          setShowInfoModal(true);
        } else {
          setShowInfoModal(false);
        }
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        if (showInfoModal) setShowInfoModal(false);
        return;
      }

      // Left/right arrows: seek 10s backward/forward
      if (key === "arrowleft") {
        event.preventDefault();
        seekRelative(-10);
        return;
      }
      if (key === "arrowright") {
        event.preventDefault();
        seekRelative(10);
        return;
      }

      // Up/down arrows: volume
      if (key === "arrowup") {
        event.preventDefault();
        if (muted) {
          setMuted(false);
          setVolume(0.1);
        } else {
          const step = Math.round(volume * 10);
          const next = Math.min(10, step + 1);
          setVolume(next / 10);
        }
        return;
      }
      if (key === "arrowdown") {
        event.preventDefault();
        if (muted) return;
        const step = Math.round(volume * 10);
        if (step <= 1) {
          setMuted(true);
        } else {
          setVolume(Math.max(1, step - 1) / 10);
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [muted, volume, showInfoModal, filePath, isPlaying]);

  // ── Player actions ──────────────────────────────────────────────────
  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const seekRelative = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const target = Math.max(0, Math.min(duration, video.currentTime + seconds));
    video.currentTime = target;
    setCurrentTime(target);
  };

  const handleSeekStart = (value: number) => {
    setIsSeeking(true);
    setSeekTime(value);
  };

  const handleSeekChange = (value: number) => {
    setSeekTime(value);
  };

  const handleSeekEnd = (value: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = value;
    }
    setCurrentTime(value);
    setIsSeeking(false);
  };

  const toggleFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;
    const videoWithWebkit = video as HTMLVideoElement & {
      webkitEnterFullscreen?: () => Promise<void> | void;
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitDisplayingFullscreen?: boolean;
    };
    try {
      const isDocFullscreen = Boolean(document.fullscreenElement);
      const isWebkitFullscreen = Boolean(
        videoWithWebkit.webkitDisplayingFullscreen,
      );
      if (isDocFullscreen) {
        await document.exitFullscreen();
        trackFullscreenToggle(false);
        return;
      }
      if (isWebkitFullscreen && videoWithWebkit.webkitExitFullscreen) {
        await videoWithWebkit.webkitExitFullscreen();
        trackFullscreenToggle(false);
        return;
      }
      if (video.requestFullscreen) {
        await video.requestFullscreen();
        video.focus();
        trackFullscreenToggle(true);
        return;
      }
      if (videoWithWebkit.webkitEnterFullscreen) {
        await videoWithWebkit.webkitEnterFullscreen();
        video.focus();
        trackFullscreenToggle(true);
        return;
      }
    } catch (err) {
      console.warn("Fullscreen toggle failed", err);
    }
  };

  const handleShareWatch = async () => {
    if (!filePath) return;
    const url = new URL(window.location.href);
    url.searchParams.set("file", filePath);
    url.searchParams.set("source", mediaSource);
    url.hash = "";
    const shareUrl = url.toString();

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Watch: ${infoMetadata?.title || filePath}`,
          url: shareUrl,
        });
        trackShare("video", filePath, "native");
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
      trackShare("video", filePath, "clipboard");
    } catch (err) {
      console.warn("Failed to copy URL to clipboard", err);
    }
  };

  // ── Cover image URL helper ──────────────────────────────────────────
  const buildCoverImageUrl = (metadata: MediaMetadata): string | null => {
    if (metadata.coverUrl) return metadata.coverUrl;
    if (metadata.coverLocal) {
      if (mediaSource === "remote") {
        return `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(metadata.coverLocal)}`;
      }
      return `/api/covers/${encodeURIComponent(metadata.coverLocal)}`;
    }
    if (metadata.coverPath)
      return `/api/local-image?path=${encodeURIComponent(metadata.coverPath)}`;
    return null;
  };

  // ── Displayed time ──────────────────────────────────────────────────
  const displayTime = isSeeking ? seekTime : currentTime;

  // ── No file selected ────────────────────────────────────────────────
  if (!filePath) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-black text-neutral-100">
        <div className="max-w-md space-y-4 px-6 text-center">
          <h1 className="text-2xl font-bold">Watch</h1>
          <p className="text-neutral-400">
            No file specified. Use a URL like:
          </p>
          <code className="block rounded bg-white/10 px-3 py-2 text-sm text-neutral-200">
            /watch?file=path/to/video.mp4
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-black text-neutral-100">
      {/* Video area */}
      <main className="relative flex-1 min-h-0">
        <div
          className={`relative h-full w-full overflow-hidden bg-black ${crtEnabled ? "crt-frame" : ""}`}
        >
          {/* Loading blue screen */}
          {isVideoLoading && (
            <div className="absolute inset-0 z-0" style={{ backgroundColor: "#0000FF" }} />
          )}

          {/* Error state */}
          {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="max-w-md space-y-2 px-6 text-center">
                <p className="text-lg font-semibold text-red-400">Playback Error</p>
                <p className="text-sm text-neutral-400">{error}</p>
              </div>
            </div>
          )}

          {/* Video element */}
          <video
            ref={videoRef}
            autoPlay
            muted={muted}
            playsInline
            webkit-playsinline="true"
            x-webkit-airplay="deny"
            controls={false}
            disablePictureInPicture
            disableRemotePlayback
            controlsList="nodownload noremoteplayback noplaybackrate nofullscreen"
            onContextMenu={(e) => e.preventDefault()}
            onClick={togglePlayPause}
            tabIndex={0}
            className={`relative z-10 h-full w-full bg-black object-contain ${
              error ? "hidden" : ""
            }`}
            style={{ pointerEvents: "auto" }}
          />

          {/* Play/pause overlay icon (briefly shown on click) */}

          {/* Volume overlay */}
          <div
            className={`absolute top-4 right-4 z-20 transition-opacity duration-300 ${
              showVolumeOverlay
                ? "opacity-100"
                : "opacity-0 pointer-events-none"
            }`}
          >
            <div className="channel-overlay font-mono">
              {muted ? (
                <span className="channel-name">MUTE</span>
              ) : (
                <>
                  <span className="channel-name">VOL</span>
                  <span className="channel-number">
                    {Math.round(volume * 10)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Controls overlay at bottom */}
          {!isFullscreen && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4">
              <div className="pointer-events-auto w-full max-w-4xl space-y-2 rounded-md border border-white/15 bg-black/70 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur">
                {/* Seek bar */}
                <div className="flex items-center gap-3">
                  <span className="min-w-[48px] text-right font-mono text-xs tabular-nums text-neutral-400">
                    {formatTime(displayTime)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={displayTime}
                    onMouseDown={(e) =>
                      handleSeekStart(parseFloat((e.target as HTMLInputElement).value))
                    }
                    onTouchStart={(e) =>
                      handleSeekStart(parseFloat((e.target as HTMLInputElement).value))
                    }
                    onChange={(e) =>
                      isSeeking
                        ? handleSeekChange(parseFloat(e.target.value))
                        : handleSeekStart(parseFloat(e.target.value))
                    }
                    onMouseUp={(e) =>
                      handleSeekEnd(parseFloat((e.target as HTMLInputElement).value))
                    }
                    onTouchEnd={(e) =>
                      handleSeekEnd(parseFloat((e.target as HTMLInputElement).value))
                    }
                    className="watch-seek-bar flex-1"
                  />
                  <span className="min-w-[48px] font-mono text-xs tabular-nums text-neutral-400">
                    {formatTime(duration)}
                  </span>
                </div>

                {/* Buttons */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={togglePlayPause}
                    className="inline-flex items-center justify-center rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                  >
                    {isPlaying ? "Pause" : "Play"}
                  </button>
                  <button
                    onClick={() =>
                      setMuted((m) => {
                        trackMuteToggle(!m);
                        return !m;
                      })
                    }
                    className={`inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-semibold transition ${
                      muted
                        ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                        : "border-white/15 bg-white/5 text-neutral-100 hover:border-white/30 hover:bg-white/10"
                    }`}
                  >
                    Mute
                  </button>
                  <button
                    onClick={() =>
                      setCrtEnabled((c) => {
                        trackCrtToggle(!c);
                        return !c;
                      })
                    }
                    className={`inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-semibold transition ${
                      crtEnabled
                        ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                        : "border-white/15 bg-white/5 text-neutral-100 hover:border-white/30 hover:bg-white/10"
                    }`}
                  >
                    CRT
                  </button>
                  <button
                    onClick={toggleFullscreen}
                    className="inline-flex items-center justify-center rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                  >
                    {isFullscreen ? "Exit" : "Full"}
                  </button>
                  <button
                    onClick={() => setShowInfoModal(true)}
                    className="inline-flex items-center justify-center rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                  >
                    Info
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Info modal */}
      <Modal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        maxWidth="max-w-2xl"
      >
        <ModalTitle>Now Watching</ModalTitle>
        {infoLoading ? (
          <div className="mt-4 text-center text-neutral-400">
            <p>Loading metadata...</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Progress bar */}
            <div className="space-y-2 border-b border-white/10 pb-4">
              <div className="flex items-baseline justify-between text-xs text-neutral-400">
                <span className="font-mono tabular-nums">
                  {formatTime(currentTime)}
                </span>
                <span className="font-mono tabular-nums">
                  {formatTime(Math.max(0, duration - currentTime))} remaining
                </span>
                <span className="font-mono tabular-nums">
                  {formatTime(duration)}
                </span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-emerald-500 transition-all duration-100 ease-linear"
                  style={{
                    width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Cover art + basic info */}
            <div className="flex gap-4">
              {infoMetadata && buildCoverImageUrl(infoMetadata) && (
                <div className="flex-shrink-0">
                  <img
                    src={buildCoverImageUrl(infoMetadata)!}
                    alt={`Cover art for ${infoMetadata?.title || "media"}`}
                    className="h-48 w-32 rounded border border-white/10 object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
              )}
              <div className="flex-1 space-y-2">
                <div>
                  <p className="text-xs text-neutral-500">Title</p>
                  <p className="text-base font-semibold text-neutral-100">
                    {infoMetadata?.title || filePath.split("/").pop()}
                  </p>
                </div>
                {infoMetadata?.year && (
                  <div>
                    <p className="text-xs text-neutral-500">Year</p>
                    <p className="text-sm text-neutral-200">
                      {infoMetadata.year}
                    </p>
                  </div>
                )}
                {infoMetadata?.releaseDate && (
                  <div>
                    <p className="text-xs text-neutral-500">Release Date</p>
                    <p className="text-sm text-neutral-200">
                      {infoMetadata.releaseDate}
                    </p>
                  </div>
                )}
                {infoMetadata?.type && (
                  <div>
                    <p className="text-xs text-neutral-500">Type</p>
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        infoMetadata.type === "film"
                          ? "bg-purple-500/20 text-purple-200"
                          : infoMetadata.type === "tv"
                            ? "bg-blue-500/20 text-blue-200"
                            : infoMetadata.type === "documentary"
                              ? "bg-amber-500/20 text-amber-200"
                              : infoMetadata.type === "sports"
                                ? "bg-green-500/20 text-green-200"
                                : infoMetadata.type === "concert"
                                  ? "bg-pink-500/20 text-pink-200"
                                  : "bg-neutral-500/20 text-neutral-200"
                      }`}
                    >
                      {infoMetadata.type === "film"
                        ? "Film"
                        : infoMetadata.type === "tv"
                          ? "TV Show"
                          : infoMetadata.type === "documentary"
                            ? "Documentary"
                            : infoMetadata.type === "sports"
                              ? "Sports"
                              : infoMetadata.type === "concert"
                                ? "Concert"
                                : "Other"}
                    </span>
                  </div>
                )}
                {infoMetadata?.director && (
                  <div>
                    <p className="text-xs text-neutral-500">Director</p>
                    <p className="text-sm text-neutral-200">
                      {infoMetadata.director}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Season / episode */}
            {(infoMetadata?.season || infoMetadata?.episode) && (
              <div className="flex gap-4 text-sm">
                {infoMetadata.season && (
                  <div>
                    <span className="text-neutral-500">Season:</span>{" "}
                    <span className="text-neutral-200">
                      {infoMetadata.season}
                    </span>
                  </div>
                )}
                {infoMetadata.episode && (
                  <div>
                    <span className="text-neutral-500">Episode:</span>{" "}
                    <span className="text-neutral-200">
                      {infoMetadata.episode}
                    </span>
                  </div>
                )}
              </div>
            )}

            {infoMetadata?.category && (
              <div>
                <p className="text-xs text-neutral-500">Category</p>
                <p className="text-sm text-neutral-200">
                  {infoMetadata.category}
                </p>
              </div>
            )}

            {infoMetadata?.plot && (
              <div>
                <p className="text-xs text-neutral-500">Plot</p>
                <p className="text-sm leading-relaxed text-neutral-300">
                  {infoMetadata.plot}
                </p>
              </div>
            )}

            {infoMetadata?.tags && infoMetadata.tags.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-neutral-500">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {infoMetadata.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-block rounded-full bg-white/10 px-2 py-0.5 text-xs text-neutral-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* File path */}
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-neutral-500">File</p>
              <p className="break-all font-mono text-xs text-neutral-400">
                {filePath}
              </p>
            </div>
          </div>
        )}
        <ModalFooter>
          <ModalButton onClick={handleShareWatch} disabled={!filePath}>
            {shareCopied ? "Copied!" : "Share"}
          </ModalButton>
          <ModalButton onClick={() => setShowInfoModal(false)}>
            Close
          </ModalButton>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}
