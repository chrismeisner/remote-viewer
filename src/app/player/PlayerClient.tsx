"use client";

import { useEffect, useRef, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  type MediaSource,
  REMOTE_MEDIA_BASE,
} from "@/constants/media";
import { Modal, ModalTitle, ModalFooter, ModalButton } from "@/components/Modal";
import { ChangelogModal } from "@/components/ChangelogModal";
import {
  trackChannelSelect,
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
const REMOTE_PREF_KEY = "player-remote-default";
const VOLUME_PREF_KEY = "player-volume-default";
const WELCOME_SEEN_KEY = "player-welcome-seen";

type NowPlaying = {
  title: string;
  relPath: string;
  durationSeconds: number;
  startOffsetSeconds: number;
  endsAt: number;
  src: string;
  serverTimeMs?: number;
};

type MediaMetadata = {
  title?: string | null;
  year?: number | null;
  releaseDate?: string | null; // ISO date string for exact release date (theatrical or event date)
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

type NowPlayingResponse = {
  nowPlaying: NowPlaying | null;
  serverTimeMs?: number;
};

type ChannelInfo = {
  id: string;
  shortName?: string;
  active?: boolean;
};

type ChangelogEntry = {
  id: string;
  date: string;
  message: string;
  category: "addition" | "update" | "removal" | "note";
};

interface PlayerClientProps {
  initialChannel?: string;
}

export default function PlayerClient({ initialChannel }: PlayerClientProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(muted);
  const [volume, setVolume] = useState(1.0); // 0.0 to 1.0
  const volumeRef = useRef(volume);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(true);
  const previousNowPlayingRef = useRef<NowPlaying | null>(null);
  const lastResolvedAtRef = useRef<number | null>(null);
  const lastRttMsRef = useRef<number>(0);
  const desiredOffsetRef = useRef<number | null>(null);
  // Default to "remote" so fresh browsers (incognito, new users) work immediately
  // Users can switch to "local" via the admin panel if they have local media
  const [mediaSource, setMediaSource] = useState<MediaSource>("remote");
  const [channel, setChannel] = useState<string | null>(initialChannel ?? null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const initialChannelSet = useRef(!!initialChannel);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([]);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoMetadata, setInfoMetadata] = useState<MediaMetadata | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);
  const [isMobile] = useState(() => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  
  // Stream stats for info modal (simplified - just buffer health)
  const [streamStats, setStreamStats] = useState<{
    bufferedSeconds: number;
    isBuffering: boolean;
  }>({ bufferedSeconds: 0, isBuffering: false });
  
  // Channel overlay state for CRT-style display
  const [showChannelOverlay, setShowChannelOverlay] = useState(false);
  const [overlayChannel, setOverlayChannel] = useState<ChannelInfo | null>(null);
  const overlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track if we've already checked for changelog updates this session
  const changelogCheckedRef = useRef(false);
  
  // Numeric input buffer for multi-digit channel selection (like a real TV remote)
  const [channelInputBuffer, setChannelInputBuffer] = useState("");
  const channelInputTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Volume overlay state
  const [showVolumeOverlay, setShowVolumeOverlay] = useState(false);
  const volumeOverlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const triggerVolumeOverlay = (isMuted: boolean) => {
    if (volumeOverlayTimeoutRef.current) {
      clearTimeout(volumeOverlayTimeoutRef.current);
    }

    setShowVolumeOverlay(true);

    if (!isMuted) {
      volumeOverlayTimeoutRef.current = setTimeout(() => {
        setShowVolumeOverlay(false);
      }, 1500);
    }
  };

  // Video loading state - show blue screen while buffering
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  // Check for today's changelog entries on mount
  useEffect(() => {
    if (changelogCheckedRef.current) return;
    
    const checkChangelog = async () => {
      try {
        const res = await fetch(`/api/changelog?source=${mediaSource}`);
        if (!res.ok) return;
        
        const data = await res.json();
        const entries = data.changelog?.entries || [];
        
        if (entries.length === 0) return;
        
        // Get today's date in local timezone (YYYY-MM-DD format)
        const today = new Date();
        const todayStr = today.toLocaleDateString("en-CA"); // en-CA gives YYYY-MM-DD format
        
        // Filter entries that match today's date
        const todaysEntries = entries.filter((entry: ChangelogEntry) => {
          const entryDate = new Date(entry.date);
          const entryStr = entryDate.toLocaleDateString("en-CA");
          return entryStr === todayStr;
        });
        
        if (todaysEntries.length > 0) {
          setChangelogEntries(todaysEntries);
          // Don't show immediately - wait for welcome modal to close
        }
        
        changelogCheckedRef.current = true;
      } catch (error) {
        console.warn("Failed to check changelog", error);
        changelogCheckedRef.current = true;
      }
    };
    
    checkChangelog();
  }, [mediaSource]);

  // Reset playback context when channel changes to ensure fresh offsets.
  useEffect(() => {
    previousNowPlayingRef.current = null;
    setNowPlaying(null);
    lastResolvedAtRef.current = null;
    lastRttMsRef.current = 0;
  }, [channel]);

  // Show channel overlay when channel changes
  const triggerChannelOverlay = (channelInfo: ChannelInfo, startLoading = true) => {
    // Clear any existing timeout
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
    }
    
    setOverlayChannel(channelInfo);
    setShowChannelOverlay(true);
    
    // Set loading state - will show blue screen until video is ready
    if (startLoading) {
      setIsVideoLoading(true);
    }
    
    // Don't auto-hide while loading - we'll hide when video is ready
    // Only set timeout if not in loading state
    if (!startLoading) {
      overlayTimeoutRef.current = setTimeout(() => {
        setShowChannelOverlay(false);
      }, 2000);
    }
  };
  
  // Called when video is ready to play - hide loading state and start overlay timeout
  const onVideoReady = () => {
    setIsVideoLoading(false);
    
    // Now start the overlay hide timeout
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
    }
    overlayTimeoutRef.current = setTimeout(() => {
      setShowChannelOverlay(false);
    }, 2000);
  };

  // Cleanup overlay timeout on unmount
  useEffect(() => {
    return () => {
      if (overlayTimeoutRef.current) {
        clearTimeout(overlayTimeoutRef.current);
      }
      if (volumeOverlayTimeoutRef.current) {
        clearTimeout(volumeOverlayTimeoutRef.current);
      }
      if (channelInputTimeoutRef.current) {
        clearTimeout(channelInputTimeoutRef.current);
      }
    };
  }, []);

  // Track watch duration when user leaves the page
  useEffect(() => {
    const handleBeforeUnload = () => {
      const video = videoRef.current;
      if (nowPlaying && channel && video && video.currentTime > 0) {
        trackWatchDuration({
          videoTitle: nowPlaying.title || nowPlaying.relPath,
          videoPath: nowPlaying.relPath,
          channelId: channel,
          watchedSeconds: video.currentTime - (nowPlaying.startOffsetSeconds || 0),
          totalDurationSeconds: nowPlaying.durationSeconds,
        });
      }
    };
    
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [nowPlaying, channel]);

  // Show volume overlay when volume changes or mute toggles
  useEffect(() => {
    triggerVolumeOverlay(muted);
  }, [volume, muted]);

  // Allow hiding the global header on the home page (toggled via "h" key)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const classList = document.body.classList;
    if (!showHeader) {
      classList.add("header-hidden");
    } else {
      classList.remove("header-hidden");
    }
    return () => classList.remove("header-hidden");
  }, [showHeader]);

  // Load media source preference from localStorage and stay in sync with other tabs/pages.
  // Default to "remote" if nothing is stored (works better for deployed apps)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncSource = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      // Only switch to "local" if explicitly set; otherwise keep "remote" as default
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
  }, []);

  // Load muted preference from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(MUTED_PREF_KEY);
    if (stored === "true" || stored === "false") {
      setMuted(stored === "true");
    } else {
      // Default to muted on first load
      localStorage.setItem(MUTED_PREF_KEY, "true");
      setMuted(true);
    }
  }, []);

  // Persist muted preference when it changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(MUTED_PREF_KEY, muted ? "true" : "false");
  }, [muted]);

  // Load CRT preference from localStorage
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

  // Persist CRT preference and update analytics user property
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CRT_PREF_KEY, crtEnabled ? "true" : "false");
    setUserProperties({ crt_enabled: crtEnabled });
  }, [crtEnabled]);

  // Load volume preference from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(VOLUME_PREF_KEY);
    if (stored !== null) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        setVolume(parsed);
      }
    } else {
      // Default to 100% volume
      localStorage.setItem(VOLUME_PREF_KEY, "1.0");
      setVolume(1.0);
    }
  }, []);

  // Persist volume preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(VOLUME_PREF_KEY, volume.toString());
  }, [volume]);

  // Load remote/controls preference from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(REMOTE_PREF_KEY);
    if (stored === "true" || stored === "false") {
      setShowControls(stored === "true");
    } else {
      localStorage.setItem(REMOTE_PREF_KEY, "true");
      setShowControls(true);
    }
  }, []);

  // Persist remote/controls preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(REMOTE_PREF_KEY, showControls ? "true" : "false");
  }, [showControls]);

  // Check if this is a first-time visitor (show welcome only once per browser)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasSeenWelcome = localStorage.getItem(WELCOME_SEEN_KEY);
    if (!hasSeenWelcome) {
      setShowWelcome(true);
    }
  }, []);

  // Re-apply media source mapping when source changes
  useEffect(() => {
    setNowPlaying((prev) => (prev ? withMediaSource(prev, mediaSource) : prev));
  }, [mediaSource]);

  const computeExpectedOffset = (entry: NowPlaying) => {
    const clientNow = Date.now();
    const serverStamped = entry.serverTimeMs ?? lastResolvedAtRef.current ?? clientNow;
    const rttMs = lastRttMsRef.current;
    const adjustedServerTime = serverStamped + rttMs / 2; // approximate midpoint of RTT
    const elapsed = Math.max(0, (clientNow - adjustedServerTime) / 1000);
    const desired = entry.startOffsetSeconds + elapsed;
    return clampTime(desired, entry.durationSeconds);
  };

  useEffect(() => {
    // Don't fetch if no channel is selected
    if (!channel) {
      setNowPlaying(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const loadNowPlaying = async () => {
      const startedAt = Date.now();
      setError(null);
      try {
        const res = await fetch(
          `/api/now-playing?channel=${encodeURIComponent(channel)}&source=${encodeURIComponent(mediaSource)}`,
        );
        if (!res.ok) {
          const text = await res.text();
          try {
            const body = JSON.parse(text);
            throw new Error(body?.error || res.statusText);
          } catch {
            throw new Error(text || "Unable to resolve current playback");
          }
        }
        const data = (await res.json()) as NowPlayingResponse;
        if (!cancelled) {
          console.log("[player] now-playing fetched", {
            channel,
            title: data?.nowPlaying?.title,
            relPath: data?.nowPlaying?.relPath,
            startOffsetSeconds: data?.nowPlaying?.startOffsetSeconds,
            endsAt: data?.nowPlaying?.endsAt,
            fetchedAt: new Date().toISOString(),
            serverTimeMs: data?.serverTimeMs,
          });
          const resolvedAt = Date.now();
          lastResolvedAtRef.current = resolvedAt;
          lastRttMsRef.current = Math.max(0, resolvedAt - startedAt);
          if (data?.nowPlaying) {
            setNowPlaying(
              withMediaSource(
                { ...data.nowPlaying, serverTimeMs: data.serverTimeMs },
                mediaSource,
              ),
            );
          } else {
            setNowPlaying(null);
            // No content scheduled - clear loading state but keep overlay visible briefly
            setIsVideoLoading(false);
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Unable to resolve current playback";
          setError(message);
          setNowPlaying(null);
          // Clear loading state on error
          setIsVideoLoading(false);
        }
      }
    };

    loadNowPlaying();
    return () => {
      cancelled = true;
    };
  }, [refreshToken, channel, mediaSource]);

  // Schedule next fetch when current program ends (replaces 30s polling)
  useEffect(() => {
    if (!nowPlaying?.endsAt) return;
    const msUntilEnd = nowPlaying.endsAt - Date.now();
    // Add small buffer (500ms) to ensure server has moved to next slot
    const delay = Math.max(100, msUntilEnd + 500);
    console.log("[player] scheduling next fetch in", Math.round(delay / 1000), "seconds");
    const timeout = setTimeout(() => {
      setRefreshToken((t) => t + 1);
    }, delay);
    return () => clearTimeout(timeout);
  }, [nowPlaying?.endsAt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!nowPlaying) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      previousNowPlayingRef.current = null;
      lastResolvedAtRef.current = null;
      desiredOffsetRef.current = null;
      return;
    }

    const computeDesiredTime = () =>
      clampTime(
        computeExpectedOffset(nowPlaying),
        video.duration || nowPlaying.durationSeconds,
        1,
      );
    const seekToDesired = () => {
      const desiredTime = computeDesiredTime();
      desiredOffsetRef.current = desiredTime;
      try {
        video.currentTime = desiredTime;
        console.log("[player] seek applied", {
          channel,
          relPath: nowPlaying.relPath,
          desiredTime,
          videoDuration: video.duration,
        });
      } catch (err) {
        console.warn("Failed to set video offset", err);
      }
      return desiredTime;
    };
    const ensureSeeked = (attempt = 0) => {
      const desired = desiredOffsetRef.current;
      if (desired === null) return;
      const delta = Math.abs((video.currentTime || 0) - desired);
      if (delta > 0.5 && attempt < 2) {
        try {
          video.currentTime = desired;
          console.log("[player] seek retry", {
            attempt,
            desired,
            currentTime: video.currentTime,
            duration: video.duration,
          });
        } catch (err) {
          console.warn("Seek retry failed", err);
        }
        setTimeout(() => ensureSeeked(attempt + 1), 250);
      }
    };

    const attemptPlay = async (allowFallback = true): Promise<boolean> => {
      try {
        await video.play();
        console.log("[player] autoplay started");
        // Track video start
        if (channel) {
          trackVideoStart({
            videoTitle: nowPlaying.title || nowPlaying.relPath,
            videoPath: nowPlaying.relPath,
            channelId: channel,
            startOffset: nowPlaying.startOffsetSeconds,
          });
        }
        return true;
      } catch (err) {
        console.warn("Autoplay failed", err);
        if (allowFallback && !video.muted) {
          console.log("[player] retrying autoplay muted");
          video.muted = true;
          setMuted(true);
          return attemptPlay(false);
        }
        return false;
      }
    };

    const handleLoaded = () => {
      // Ensure newly-loaded media respects the latest mute state without
      // forcing the whole player wiring effect to re-run on every mute toggle.
      video.muted = mutedRef.current;
      video.volume = volumeRef.current;
      const desiredTime = seekToDesired();
      console.log("[player] new media load", {
        channel,
        relPath: nowPlaying.relPath,
        startOffsetSeconds: nowPlaying.startOffsetSeconds,
        desiredTime,
        at: new Date().toISOString(),
      });
      attemptPlay(true);
    };
    
    // Called when video has enough data to play - clear loading state
    const handleCanPlay = () => {
      console.log("[player] video can play, clearing loading state");
      onVideoReady();
    };
    
    // Called when video stalls due to buffering - show loading state
    const handleWaiting = () => {
      console.log("[player] video buffering (waiting)");
      setIsVideoLoading(true);
    };
    
    // Called when video resumes playing - clear loading state
    const handlePlaying = () => {
      console.log("[player] video playing, clearing loading state");
      onVideoReady();
    };
    
    // Called when video fails to load
    const handleError = () => {
      const errorDetails = {
        code: video.error?.code,
        message: video.error?.message,
        relPath: nowPlaying.relPath,
        src: nowPlaying.src,
      };
      console.error("[player] video error", errorDetails);
      
      // Clear loading state on error
      setIsVideoLoading(false);
      
      if (channel) {
        trackVideoError({
          videoPath: nowPlaying.relPath,
          channelId: channel,
          errorType: "load_failed",
          errorMessage: video.error?.message,
        });
      }
      
      // MediaError codes:
      // 1 = MEDIA_ERR_ABORTED - fetching process aborted by user
      // 2 = MEDIA_ERR_NETWORK - network error
      // 3 = MEDIA_ERR_DECODE - decoding error
      // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED - format not supported or source unavailable
      
      // For network errors or source not available, we could retry
      if (video.error?.code === 2 || video.error?.code === 4) {
        console.log("[player] network/source error detected, will retry on next schedule update");
      }
    };
    
    // Called when video stalls for too long (buffer issues)
    const handleStalled = () => {
      console.warn("[player] video stalled (network issue)");
      if (channel) {
        trackVideoError({
          videoPath: nowPlaying.relPath,
          channelId: channel,
          errorType: "buffer_stall",
        });
      }
    };

    video.src = nowPlaying.src;
    video.preload = "auto";
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute(
      "controlsList",
      "nodownload noremoteplayback noplaybackrate nofullscreen"
    );
    video.load();
    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("error", handleError);
    video.addEventListener("stalled", handleStalled);
    const preventPause = () => {
      if (video.paused) {
        video
          .play()
          .catch((err) => console.warn("Autoplay resume failed", err));
      }
    };
    video.addEventListener("pause", preventPause);
    const lateSeek = setTimeout(() => ensureSeeked(0), 300);
    previousNowPlayingRef.current = nowPlaying;

    return () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("error", handleError);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("pause", preventPause);
      clearTimeout(lateSeek);
    };
  }, [nowPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    mutedRef.current = muted;
    video.muted = muted;
  }, [muted]);

  // Sync volume to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    volumeRef.current = volume;
    video.volume = volume;
  }, [volume]);

  // Fetch metadata when nowPlaying changes (for overlay cover and info modal)
  useEffect(() => {
    if (!nowPlaying) {
      setInfoMetadata(null);
      return;
    }
    
    // Reset and fetch new metadata
    setInfoLoading(true);
    
    fetch(`/api/media-metadata?file=${encodeURIComponent(nowPlaying.relPath)}&source=${mediaSource}`)
      .then(res => res.json())
      .then(data => {
        setInfoMetadata(data.metadata || {});
        setInfoLoading(false);
      })
      .catch(() => {
        setInfoMetadata({});
        setInfoLoading(false);
      });
  }, [nowPlaying?.relPath, mediaSource]);

  // Update current playback time when info modal is open
  useEffect(() => {
    if (!showInfoModal) return;
    
    const video = videoRef.current;
    if (!video) return;
    
    const updateTime = () => {
      setCurrentPlaybackTime(video.currentTime || 0);
    };
    
    // Update immediately
    updateTime();
    
    // Update every 100ms for smooth progress
    const interval = setInterval(updateTime, 100);
    
    return () => clearInterval(interval);
  }, [showInfoModal]);

  // Track buffer health when info modal is open (simplified - no download rate calculation)
  useEffect(() => {
    if (!showInfoModal) {
      setStreamStats({ bufferedSeconds: 0, isBuffering: false });
      return;
    }
    
    const video = videoRef.current;
    if (!video) return;
    
    const updateStreamStats = () => {
      const buffered = video.buffered;
      const currentTime = video.currentTime;
      
      // Calculate buffered seconds ahead of current playback position
      let bufferedAhead = 0;
      for (let i = 0; i < buffered.length; i++) {
        const start = buffered.start(i);
        const end = buffered.end(i);
        if (currentTime >= start && currentTime <= end) {
          bufferedAhead = end - currentTime;
          break;
        }
      }
      
      // Determine if currently buffering (video is paused due to lack of data)
      const isBuffering = video.readyState < 3 && !video.paused;
      
      setStreamStats({
        bufferedSeconds: bufferedAhead,
        isBuffering,
      });
    };
    
    // Update immediately
    updateStreamStats();
    
    // Update every second (reduced from 500ms)
    const interval = setInterval(updateStreamStats, 1000);
    
    return () => {
      clearInterval(interval);
    };
  }, [showInfoModal]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (active) {
        // Focus video so arrow keys work while fullscreen (especially mobile Safari).
        videoRef.current?.focus();
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    // iOS Safari fires video-specific fullscreen events instead of the standard API.
    const video = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
      webkitDisplayingFullscreen?: boolean;
    }) | null;
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

  // Helper to switch channel and trigger overlay
  const switchToChannel = (channelId: string) => {
    const channelInfo = channels.find(c => c.id === channelId);
    if (channelInfo) {
      // Track watch duration for the video we're leaving (before switching)
      const video = videoRef.current;
      if (nowPlaying && channel && video && video.currentTime > 0) {
        trackWatchDuration({
          videoTitle: nowPlaying.title || nowPlaying.relPath,
          videoPath: nowPlaying.relPath,
          channelId: channel,
          watchedSeconds: video.currentTime - (nowPlaying.startOffsetSeconds || 0),
          totalDurationSeconds: nowPlaying.durationSeconds,
        });
      }
      
      setChannel(channelId);
      triggerChannelOverlay(channelInfo);
      setRefreshToken((token) => token + 1);
      // Track channel selection
      trackChannelSelect(channelId, channelInfo.shortName);
    }
  };

  const channelUp = () => {
    if (channels.length === 0) return;
    if (!channel) {
      switchToChannel(channels[0].id);
      return;
    }
    const idx = channels.findIndex((c) => c.id === channel);
    const next = idx === -1 || idx === channels.length - 1 ? channels[0] : channels[idx + 1];
    switchToChannel(next.id);
  };

  const channelDown = () => {
    if (channels.length === 0) return;
    if (!channel) {
      switchToChannel(channels[0].id);
      return;
    }
    const idx = channels.findIndex((c) => c.id === channel);
    const prev =
      idx <= 0 ? channels[channels.length - 1] : channels[Math.max(0, idx - 1)];
    switchToChannel(prev.id);
  };

  // Keyboard shortcuts: number keys 1-9 jump to matching channel name (if present).
  // "m" toggles mute, "f" toggles fullscreen, "c" toggles CRT.
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
        // Toggle info modal - metadata is already fetched when nowPlaying changes
        if (!showInfoModal && nowPlaying) {
          setShowInfoModal(true);
        } else {
          setShowInfoModal(false);
        }
        return;
      }

      if (key === "/") {
        event.preventDefault();
        setShowWelcome(true);
        return;
      }

      if (key === "z") {
        event.preventDefault();
        setShowHeader((prev) => !prev);
        return;
      }

      if (key === "r") {
        event.preventDefault();
        setShowControls((prev) => !prev);
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        if (showWelcome) setShowWelcome(false);
        if (showChannelInfo) setShowChannelInfo(false);
        if (showInfoModal) setShowInfoModal(false);
        return;
      }

      if (key === "arrowup") {
        event.preventDefault();
        channelUp();
        return;
      }

      if (key === "arrowdown") {
        event.preventDefault();
        channelDown();
        return;
      }

      if (key === "arrowleft") {
        event.preventDefault();
        // If already muted, do nothing
        if (muted) return;
        
        // Convert to step (1-10) for easier comparison
        const currentStep = Math.round(volume * 10);
        
        // If at step 1, mute instead of going to 0
        if (currentStep <= 1) {
          setMuted(true);
        } else {
          // Decrease volume by 1 step (out of 10)
          const newStep = Math.max(1, currentStep - 1);
          setVolume(newStep / 10);
        }
        return;
      }

      if (key === "arrowright") {
        event.preventDefault();
        // If muted, unmute and set to step 1
        if (muted) {
          setMuted(false);
          setVolume(0.1);
        } else {
          // Convert to step (1-10) for easier math
          const currentStep = Math.round(volume * 10);
          // Increase volume by 1 step (out of 10)
          const newStep = Math.min(10, currentStep + 1);
          if (newStep === currentStep && newStep === 10) {
            // Already at max - still show overlay to confirm level
            triggerVolumeOverlay(false);
          } else {
            setVolume(newStep / 10);
          }
        }
        return;
      }

      // Handle numeric input for channel selection (0-9)
      if (!/^[0-9]$/.test(key)) return;
      
      event.preventDefault();
      
      // Clear any existing timeout
      if (channelInputTimeoutRef.current) {
        clearTimeout(channelInputTimeoutRef.current);
      }
      
      // Add the digit to the buffer
      const newBuffer = channelInputBuffer + key;
      setChannelInputBuffer(newBuffer);
      
      const channelIds = channels.map(c => c.id);
      
      // Check if exact match exists
      const exactMatch = channelIds.includes(newBuffer);
      
      // Check if any channel starts with the current buffer (potential longer match)
      const hasPotentialLongerMatch = channelIds.some(id => 
        id.startsWith(newBuffer) && id.length > newBuffer.length
      );
      
      // If we have an exact match and no potential longer matches, switch immediately
      if (exactMatch && !hasPotentialLongerMatch) {
        setChannelInputBuffer("");
        switchToChannel(newBuffer);
        return;
      }
      
      // Otherwise, wait for more input
      channelInputTimeoutRef.current = setTimeout(() => {
        if (exactMatch) {
          switchToChannel(newBuffer);
        }
        setChannelInputBuffer("");
      }, 800);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [channels, channel, muted, volume, channelInputBuffer, showInfoModal, nowPlaying, mediaSource]);

  const resolvedSrc = (np: NowPlaying | null) =>
    np ? withMediaSource(np, mediaSource).src : "";

  // Normalize channels to ChannelInfo format (handles legacy string[] responses)
  // Also filters out inactive channels (active !== false means active)
  const normalizeChannels = (channels: unknown): ChannelInfo[] => {
    if (!Array.isArray(channels)) return [];
    return channels
      .map((ch) => {
        if (typeof ch === "string") {
          return { id: ch, active: true };
        }
        if (ch && typeof ch === "object" && typeof (ch as ChannelInfo).id === "string") {
          return ch as ChannelInfo;
        }
        return null;
      })
      .filter((ch): ch is ChannelInfo => ch !== null && ch.active !== false);
  };

  useEffect(() => {
    let cancelled = false;
    const loadChannels = async () => {
      setLoadingChannels(true);
      try {
        const res = await fetch(
          `/api/channels?source=${encodeURIComponent(mediaSource)}`,
        );
        if (!res.ok) throw new Error("Failed to load channels");
        const data = await res.json();
        const channelList = normalizeChannels(data.channels);
        if (!cancelled) {
          setChannels(channelList);
          
          const channelIds = channelList.map(c => c.id);
          
          if (channelList.length === 0) {
            // No channels available
            setChannel(null);
            return;
          }
          
          // Determine if we need to set/change the channel
          const needsChannelSelection = !channel || !channelIds.includes(channel);
          
          if (needsChannelSelection) {
            let targetChannelId: string | null = null;
            
            // Check for URL parameter on first load only (skip if initialChannel was provided)
            if (typeof window !== 'undefined' && !initialChannelSet.current) {
              const urlParams = new URLSearchParams(window.location.search);
              const channelParam = urlParams.get('channel');
              
              // Mark that we've checked the URL param (do this regardless of validity)
              initialChannelSet.current = true;
              
              if (channelParam && channelIds.includes(channelParam)) {
                targetChannelId = channelParam;
                console.log('[player] starting on channel from URL param:', channelParam);
              } else if (channelParam) {
                console.warn('[player] URL channel param invalid:', channelParam, 'available:', channelIds);
              }
            }
            
            // Use URL param channel if found, otherwise use first channel
            const targetChannel = targetChannelId 
              ? channelList.find(c => c.id === targetChannelId)!
              : channelList[0];
            
            setChannel(targetChannel.id);
            triggerChannelOverlay(targetChannel);
            setRefreshToken((token) => token + 1);
          }
        }
      } catch (err) {
        console.warn("Channel list error", err);
        if (!cancelled) {
          setChannels([]);
          setChannel(null);
        }
      } finally {
        if (!cancelled) setLoadingChannels(false);
      }
    };

    loadChannels();
    return () => {
      cancelled = true;
    };
  }, [mediaSource]);

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
      const isWebkitFullscreen = Boolean(videoWithWebkit.webkitDisplayingFullscreen);

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

  const nowPlayingLabel = nowPlaying?.title || nowPlaying?.relPath || "Waiting for schedule";
  const overlayChannelId = overlayChannel?.id
    ? overlayChannel.id.toString().padStart(2, "0")
    : "";
  const closeWelcome = () => {
    setShowWelcome(false);
    // Remember that this browser has seen the welcome modal
    localStorage.setItem(WELCOME_SEEN_KEY, "true");
    // After closing welcome modal, check if we should show changelog
    if (!changelogCheckedRef.current && changelogEntries.length > 0) {
      setShowChangelog(true);
    }
  };
  const closeChannelInfo = () => setShowChannelInfo(false);
  const closeChangelog = () => setShowChangelog(false);
  const closeInfoModal = () => setShowInfoModal(false);
  
  const handleShareChannel = async () => {
    if (!channel) return;
    const url = new URL(window.location.href);
    url.searchParams.set('channel', channel);
    // Remove any other search params that shouldn't be shared
    url.hash = '';
    
    const shareUrl = url.toString();
    
    // Use native share sheet on mobile if available
    if (isMobile && navigator.share) {
      try {
        await navigator.share({
          title: `Watch ${channel}`,
          url: shareUrl,
        });
        trackShare("channel", channel, "native");
        return;
      } catch (err) {
        // User cancelled share sheet – don't fall through
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }
    
    // Desktop or fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
      trackShare("channel", channel, "clipboard");
    } catch (err) {
      console.warn('Failed to copy URL to clipboard', err);
    }
  };
  
  // Helper to build cover image URL - accounts for media source
  const buildCoverImageUrl = (metadata: MediaMetadata): string | null => {
    if (metadata.coverUrl) return metadata.coverUrl;
    if (metadata.coverLocal) {
      // For remote mode, coverLocal files are on the FTP/CDN server
      if (mediaSource === "remote") {
        return `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(metadata.coverLocal)}`;
      }
      return `/api/covers/${encodeURIComponent(metadata.coverLocal)}`;
    }
    if (metadata.coverPath) return `/api/local-image?path=${encodeURIComponent(metadata.coverPath)}`;
    return null;
  };
  // Chromeless is controlled by the header toggle only.
  // The remote visibility must never change player sizing/layout.
  const isChromeless = !showHeader;
  const mainClass = isChromeless
    ? "mx-auto w-full max-w-none px-0 pb-0 pt-0"
    : "mx-auto max-w-7xl px-6 pb-8 pt-0 space-y-4";
  // Keep the player as wide as possible even when the remote is visible.
  const playerShellClass = isChromeless ? "max-w-none" : "max-w-6xl";

  const remoteControls = (
    <div className="flex w-full flex-wrap items-stretch justify-center gap-2 sm:flex-nowrap sm:gap-3">
      <div className="flex w-full flex-nowrap gap-2 sm:flex-wrap">
        <button
          onClick={() => setCrtEnabled((c) => {
            trackCrtToggle(!c);
            return !c;
          })}
          className={`inline-flex min-w-0 flex-1 items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-semibold transition sm:w-auto sm:flex-none sm:px-3 ${
            crtEnabled
              ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
              : "border-white/15 bg-white/5 text-neutral-100 hover:border-white/30 hover:bg-white/10"
          }`}
        >
          CRT
        </button>
        <button
          onClick={() => setMuted((m) => {
            trackMuteToggle(!m);
            return !m;
          })}
          aria-pressed={muted}
          className={`inline-flex min-w-0 flex-1 items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-semibold transition sm:w-auto sm:flex-none sm:px-3 ${
            muted
              ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
              : "border-white/15 bg-white/5 text-neutral-100 hover:border-white/30 hover:bg-white/10"
          }`}
        >
          Mute
        </button>
        <button
          onClick={toggleFullscreen}
          className="inline-flex min-w-0 flex-1 items-center justify-center rounded-md border border-white/15 bg-white/5 px-2 py-2 text-center text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 sm:w-auto sm:flex-none sm:px-3"
        >
          {isFullscreen ? "Exit" : "Full"}
        </button>
        <button
          onClick={() => nowPlaying && setShowInfoModal(true)}
          disabled={!nowPlaying}
          className={`inline-flex min-w-0 flex-1 items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-semibold transition sm:w-auto sm:flex-none sm:px-3 ${
            !nowPlaying
              ? "border-white/10 bg-white/5 text-neutral-500 cursor-not-allowed"
              : "border-white/15 bg-white/5 text-neutral-100 hover:border-white/30 hover:bg-white/10"
          }`}
        >
          Info
        </button>
      </div>
      <button
        onClick={channelUp}
        className="inline-flex w-full min-w-[140px] basis-full items-center justify-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-center text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 sm:w-auto sm:flex-none sm:basis-auto"
        disabled={channels.length === 0}
      >
        Channel Up
      </button>
      <button
        onClick={channelDown}
        className="inline-flex w-full min-w-[140px] basis-full items-center justify-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-center text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 sm:w-auto sm:flex-none sm:basis-auto"
        disabled={channels.length === 0}
      >
        Channel Down
      </button>
    </div>
  );

  return (
    <div
      className={`bg-black text-neutral-100 flex flex-col ${
        isChromeless ? "h-[100dvh] overflow-hidden" : "min-h-screen"
      }`}
    >
      <main className={`${mainClass} flex-1 min-h-0`}>
        <div className={isChromeless ? "h-full" : "space-y-4"}>
          <div
            className={
              isChromeless
                ? "w-full h-full"
                : `mx-auto w-full ${playerShellClass} space-y-3 transition-all duration-300`
            }
          >
            <div
              className={`player-frame relative overflow-hidden bg-black ${
                isChromeless ? "h-full w-full" : "border border-white/10"
              } ${crtEnabled ? "crt-frame" : ""}`}
            >
              {/* Technical difficulties screen when channel is selected but nothing scheduled */}
              {channel && !nowPlaying && !isVideoLoading && (
                <div
                  className={`relative ${isChromeless ? "h-full w-full" : "aspect-video w-full"}`}
                >
                  <img
                    src="/offline.jpg"
                    alt="Technical Difficulties"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              )}

              {/* Blue screen fallback when channel is selected and video is loading */}
              {channel && isVideoLoading && (
                <div
                  className={isChromeless ? "h-full w-full" : "aspect-video w-full"}
                  style={{ backgroundColor: "#0000FF" }}
                />
              )}

              {/* Video element - hidden when showing blue screen */}
              <video
                ref={videoRef}
                // Avoid remounting between videos so browsers keep fullscreen active.
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
                tabIndex={0}
                className={`relative z-10 bg-black ${
                  isChromeless ? "h-full w-full object-contain" : "aspect-video w-full"
                } ${channel && (!nowPlaying || isVideoLoading) ? "hidden" : ""}`}
                style={{ pointerEvents: 'auto' }}
              />

              {/* CRT-style channel overlay - stays visible while loading or no programming */}
              <div
                className={`absolute top-4 left-4 z-10 transition-opacity duration-500 ${
                  showChannelOverlay || isVideoLoading || (channel && !nowPlaying) ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <div className="channel-overlay font-mono">
                  <span className="channel-number">{overlayChannelId}</span>
                  {overlayChannel?.shortName && (
                    <span className="channel-name">{overlayChannel.shortName}</span>
                  )}
                  {/* Blinking cursor while loading or no programming */}
                  {(isVideoLoading || (channel && !nowPlaying)) && (
                    <span className="channel-cursor">▌</span>
                  )}
                </div>
              </div>

              {/* Volume overlay - shows when volume changes */}
              <div
                className={`absolute top-4 right-4 z-10 ${
                  showVolumeOverlay ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <div className="channel-overlay font-mono">
                  {muted ? (
                    <span className="channel-name">MUTE</span>
                  ) : (
                    <>
                      <span className="channel-name">VOL</span>
                      <span className="channel-number">{Math.round(volume * 10)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Desktop overlay remote (md+) */}
              {showControls && !isFullscreen && (
                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-[4vh] z-20 justify-center px-4 ${
                    // In chromeless mode the player fills the viewport, so we always overlay
                    // (under-player would be clipped by overflow-hidden).
                    isChromeless ? "flex" : "hidden md:flex"
                  }`}
                >
                  <div className="pointer-events-auto w-full max-w-3xl rounded-md border border-white/15 bg-black/60 p-2 shadow-2xl shadow-black/40 backdrop-blur">
                    {remoteControls}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile under-player remote (< md) */}
            {showControls && !isChromeless && (
              <div className={`md:hidden ${isFullscreen ? "hidden" : ""}`}>{remoteControls}</div>
            )}
          </div>
        </div>
      </main>

      <Modal open={showChannelInfo} onClose={closeChannelInfo} maxWidth="max-w-lg">
        <h2 className="text-xl font-semibold text-neutral-50">Channel info</h2>
        <p className="mt-2 text-sm text-neutral-300">
          Select a channel and view current source and title.
        </p>
        <div className="mt-4 space-y-3 text-sm text-neutral-200">
          <div className="flex items-center gap-3">
            <label className="text-neutral-400">Channel</label>
            {channels.length === 0 ? (
              <span className="text-neutral-500 italic">No channels available</span>
            ) : (
              <select
                className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-neutral-100"
                value={channel ?? ""}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next) {
                    switchToChannel(next);
                  }
                }}
                disabled={loadingChannels}
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.id.toString().padStart(2, "0")}{ch.shortName ? ` - ${ch.shortName}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Source:</span>
            <span className="font-semibold text-neutral-100">
              {mediaSource === "remote" ? "Remote CDN" : "Local files"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Now playing:</span>
            <span className="font-semibold text-neutral-100 truncate max-w-xs sm:max-w-sm">
              {nowPlayingLabel}
            </span>
          </div>
        </div>
        <ModalFooter>
          <ModalButton onClick={closeChannelInfo}>Close</ModalButton>
        </ModalFooter>
      </Modal>

      <Modal open={showWelcome} onClose={closeWelcome}>
        <ModalTitle>Remote Viewer</ModalTitle>
        <div className="hidden sm:block">
          <p className="mt-3 text-sm font-semibold text-neutral-200">Keyboard shortcuts</p>
          <ul className="mt-3 space-y-2 text-sm text-neutral-200">
            <li className="flex justify-between gap-4"><span>Show helper</span><span className="font-mono text-neutral-100">/</span></li>
            <li className="flex justify-between gap-4"><span>Show remote</span><span className="font-mono text-neutral-100">r</span></li>
            <li className="flex justify-between gap-4"><span>Show info</span><span className="font-mono text-neutral-100">i</span></li>
            <li className="flex justify-between gap-4"><span>Channel up</span><span className="font-mono text-neutral-100">↑</span></li>
            <li className="flex justify-between gap-4"><span>Channel down</span><span className="font-mono text-neutral-100">↓</span></li>
            <li className="flex justify-between gap-4"><span>Volume up</span><span className="font-mono text-neutral-100">→</span></li>
            <li className="flex justify-between gap-4"><span>Volume down</span><span className="font-mono text-neutral-100">←</span></li>
            <li className="flex justify-between gap-4"><span>Mute</span><span className="font-mono text-neutral-100">m</span></li>
            <li className="flex justify-between gap-4"><span>CRT Effect</span><span className="font-mono text-neutral-100">c</span></li>
            <li className="flex justify-between gap-4"><span>Fullscreen</span><span className="font-mono text-neutral-100">f</span></li>
          </ul>
        </div>
        <p className="mt-4 text-sm font-semibold text-neutral-200">Launch preferences</p>
        <div className="mt-2 flex items-center gap-2 text-sm text-neutral-200">
          <input
            id="welcome-mute"
            type="checkbox"
            className="h-4 w-4 rounded border-white/30 bg-neutral-800 text-emerald-400 focus:ring-2 focus:ring-emerald-400/50"
            checked={muted}
            onChange={(e) => setMuted(e.target.checked)}
          />
          <label htmlFor="welcome-mute" className="select-none">
            Mute
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-neutral-200">
          <input
            id="welcome-crt"
            type="checkbox"
            className="h-4 w-4 rounded border-white/30 bg-neutral-800 text-emerald-400 focus:ring-2 focus:ring-emerald-400/50"
            checked={crtEnabled}
            onChange={(e) => setCrtEnabled(e.target.checked)}
          />
          <label htmlFor="welcome-crt" className="select-none">
            CRT Effect
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-neutral-200">
          <input
            id="welcome-remote"
            type="checkbox"
            className="h-4 w-4 rounded border-white/30 bg-neutral-800 text-emerald-400 focus:ring-2 focus:ring-emerald-400/50"
            checked={showControls}
            onChange={(e) => setShowControls(e.target.checked)}
          />
          <label htmlFor="welcome-remote" className="select-none">
            Show Remote
          </label>
        </div>
        <ModalFooter>
          <ModalButton onClick={closeWelcome}>Got it</ModalButton>
        </ModalFooter>
      </Modal>

      <ChangelogModal 
        open={showChangelog} 
        onClose={closeChangelog}
        entries={changelogEntries}
      />

      <Modal open={showInfoModal} onClose={closeInfoModal} maxWidth="max-w-2xl">
        <ModalTitle>Remote Viewer</ModalTitle>
        {infoLoading ? (
          <div className="mt-4 text-center text-neutral-400">
            <p>Loading metadata...</p>
          </div>
        ) : nowPlaying ? (
          <div className="mt-4 space-y-4">
            {/* Playback progress bar */}
            <div className="space-y-2 pb-4 border-b border-white/10">
              <div className="flex justify-between items-baseline text-xs text-neutral-400">
                <span className="font-mono tabular-nums">{formatOffsetForDisplay(currentPlaybackTime)}</span>
                <span className="font-mono tabular-nums">{formatOffsetForDisplay(nowPlaying.durationSeconds - currentPlaybackTime)} remaining</span>
                <span className="font-mono tabular-nums">{formatOffsetForDisplay(nowPlaying.durationSeconds)}</span>
              </div>
              
              {/* Progress bar */}
              <div className="relative h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="absolute top-0 left-0 h-full bg-emerald-500 transition-all duration-100 ease-linear rounded-full"
                  style={{ 
                    width: `${Math.min(100, (currentPlaybackTime / nowPlaying.durationSeconds) * 100)}%` 
                  }}
                />
              </div>
            </div>

            {/* Cover art and basic info side by side */}
            <div className="flex gap-4">
              {/* Cover art */}
              {infoMetadata && buildCoverImageUrl(infoMetadata) && (
                <div className="flex-shrink-0">
                  <img
                    src={buildCoverImageUrl(infoMetadata)!}
                    alt={`Cover art for ${infoMetadata?.title || 'media'}`}
                    className="w-32 h-48 object-cover rounded border border-white/10"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
              
              {/* Basic info */}
              <div className="flex-1 space-y-2">
                <div>
                  <p className="text-xs text-neutral-500">Title</p>
                  <p className="text-base font-semibold text-neutral-100">
                    {infoMetadata?.title || nowPlaying.title}
                  </p>
                </div>
                
                {infoMetadata?.year && (
                  <div>
                    <p className="text-xs text-neutral-500">Year</p>
                    <p className="text-sm text-neutral-200">{infoMetadata.year}</p>
                  </div>
                )}
                
                {infoMetadata?.releaseDate && (
                  <div>
                    <p className="text-xs text-neutral-500">Release Date</p>
                    <p className="text-sm text-neutral-200">{infoMetadata.releaseDate}</p>
                  </div>
                )}
                
                {infoMetadata?.type && (
                  <div>
                    <p className="text-xs text-neutral-500">Type</p>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      infoMetadata.type === "film" ? "bg-purple-500/20 text-purple-200" :
                      infoMetadata.type === "tv" ? "bg-blue-500/20 text-blue-200" :
                      infoMetadata.type === "documentary" ? "bg-amber-500/20 text-amber-200" :
                      infoMetadata.type === "sports" ? "bg-green-500/20 text-green-200" :
                      infoMetadata.type === "concert" ? "bg-pink-500/20 text-pink-200" :
                      "bg-neutral-500/20 text-neutral-200"
                    }`}>
                      {infoMetadata.type === "film" ? "Film" :
                       infoMetadata.type === "tv" ? "TV Show" :
                       infoMetadata.type === "documentary" ? "Documentary" :
                       infoMetadata.type === "sports" ? "Sports" :
                       infoMetadata.type === "concert" ? "Concert" :
                       "Other"}
                    </span>
                  </div>
                )}
                
                {infoMetadata?.director && (
                  <div>
                    <p className="text-xs text-neutral-500">Director</p>
                    <p className="text-sm text-neutral-200">{infoMetadata.director}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Additional metadata */}
            {(infoMetadata?.season || infoMetadata?.episode) && (
              <div className="flex gap-4 text-sm">
                {infoMetadata.season && (
                  <div>
                    <span className="text-neutral-500">Season:</span>{" "}
                    <span className="text-neutral-200">{infoMetadata.season}</span>
                  </div>
                )}
                {infoMetadata.episode && (
                  <div>
                    <span className="text-neutral-500">Episode:</span>{" "}
                    <span className="text-neutral-200">{infoMetadata.episode}</span>
                  </div>
                )}
              </div>
            )}

            {infoMetadata?.category && (
              <div>
                <p className="text-xs text-neutral-500">Category</p>
                <p className="text-sm text-neutral-200">{infoMetadata.category}</p>
              </div>
            )}

            {infoMetadata?.makingOf && (
              <div>
                <p className="text-xs text-neutral-500">Making Of</p>
                <p className="text-sm text-neutral-200">{infoMetadata.makingOf}</p>
              </div>
            )}

            {infoMetadata?.plot && (
              <div>
                <p className="text-xs text-neutral-500">Plot</p>
                <p className="text-sm text-neutral-300 leading-relaxed">{infoMetadata.plot}</p>
              </div>
            )}

            {infoMetadata?.tags && infoMetadata.tags.length > 0 && (
              <div>
                <p className="text-xs text-neutral-500 mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {infoMetadata.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-block px-2 py-0.5 rounded-full bg-white/10 text-xs text-neutral-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stream Status - simplified */}
            <div className="pt-3 border-t border-white/10">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  streamStats.isBuffering 
                    ? "bg-amber-500 animate-pulse" 
                    : streamStats.bufferedSeconds > 30 
                      ? "bg-emerald-500" 
                      : streamStats.bufferedSeconds > 10 
                        ? "bg-yellow-500" 
                        : "bg-amber-500"
                }`} />
                <span className="text-sm text-neutral-300">
                  {streamStats.isBuffering
                    ? "Buffering..."
                    : `${Math.round(streamStats.bufferedSeconds)}s buffered`
                  }
                </span>
              </div>
            </div>

            {/* File info */}
            <div className="pt-3 border-t border-white/10">
              <p className="text-xs text-neutral-500">File</p>
              <p className="text-xs text-neutral-400 font-mono break-all">{nowPlaying.relPath}</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 text-center text-neutral-400">
            <p>No content currently playing</p>
          </div>
        )}
        <ModalFooter>
          <ModalButton 
            onClick={handleShareChannel}
            disabled={!channel}
          >
            {shareCopied ? 'Copied!' : isMobile ? 'Share Channel' : 'Copy Channel URL'}
          </ModalButton>
          <ModalButton onClick={closeInfoModal}>Close</ModalButton>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function clampTime(value: number, durationSeconds: number, bufferSeconds = 0.25): number {
  if (!Number.isFinite(value)) return 0;
  const duration = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  if (duration <= 0) return Math.max(0, value);
  const maxPlayable = Math.max(0, duration - bufferSeconds);
  return Math.min(Math.max(0, value), maxPlayable);
}

function withMediaSource(entry: { title: string; relPath: string; durationSeconds: number; startOffsetSeconds: number; endsAt: number; src: string; serverTimeMs?: number }, mediaSource: "local" | "remote"): { title: string; relPath: string; durationSeconds: number; startOffsetSeconds: number; endsAt: number; src: string; serverTimeMs?: number } {
  if (mediaSource === "remote") {
    const remote = new URL(entry.relPath, REMOTE_MEDIA_BASE).toString();
    return { ...entry, src: remote };
  }
  return entry;
}

function formatOffsetForDisplay(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}
