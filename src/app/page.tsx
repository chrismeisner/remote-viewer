"use client";

import { useEffect, useRef, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  type MediaSource,
  REMOTE_MEDIA_BASE,
} from "@/constants/media";
import { PasswordModal, isAuthenticated } from "@/components/PasswordModal";
import { Modal, ModalTitle, ModalFooter, ModalButton } from "@/components/Modal";

const MUTED_PREF_KEY = "player-muted-default";
const CRT_PREF_KEY = "player-crt-default";
const REMOTE_PREF_KEY = "player-remote-default";

type NowPlaying = {
  title: string;
  relPath: string;
  durationSeconds: number;
  startOffsetSeconds: number;
  endsAt: number;
  src: string;
  serverTimeMs?: number;
};

type NowPlayingResponse = {
  nowPlaying: NowPlaying | null;
  serverTimeMs?: number;
};

type ChannelInfo = {
  id: string;
  shortName?: string;
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(muted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(true);
  const previousNowPlayingRef = useRef<NowPlaying | null>(null);
  const lastResolvedAtRef = useRef<number | null>(null);
  const lastRttMsRef = useRef<number>(0);
  const desiredOffsetRef = useRef<number | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [channel, setChannel] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const initialChannelSet = useRef(false);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);
  
  // Password authentication state
  const [isAuthed, setIsAuthed] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState<boolean | null>(null);
  const [authCheckError, setAuthCheckError] = useState<string | null>(null);
  
  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      // First check if already authenticated this session
      if (isAuthenticated()) {
        setIsAuthed(true);
        setPasswordRequired(false);
        return;
      }
      
      // Check if password is required and if already authenticated via cookie
      try {
        const res = await fetch("/api/auth/verify");
        if (!res.ok) {
          throw new Error(`Auth check failed: ${res.status}`);
        }
        const data = await res.json();
        
        console.log("[auth] check result:", data);
        
        setPasswordRequired(data.passwordRequired);
        
        // If authenticated via cookie or no password required, allow access
        if (data.isAuthenticated) {
          setIsAuthed(true);
          // Also set sessionStorage to keep consistent state
          if (typeof window !== "undefined") {
            sessionStorage.setItem("remote-viewer-auth", "true");
          }
        }
      } catch (error) {
        console.error("[auth] check error:", error);
        setAuthCheckError(error instanceof Error ? error.message : "Auth check failed");
        // On error, require authentication to be safe
        setPasswordRequired(true);
      }
    };
    checkAuth();
  }, []);
  
  const handleAuthSuccess = () => {
    setIsAuthed(true);
    setPasswordRequired(false);
  };
  
  // Channel overlay state for CRT-style display
  const [showChannelOverlay, setShowChannelOverlay] = useState(false);
  const [overlayChannel, setOverlayChannel] = useState<ChannelInfo | null>(null);
  const overlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Video loading state - show blue screen while buffering
  const [isVideoLoading, setIsVideoLoading] = useState(false);
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
    };
  }, []);

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
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncSource = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      setMediaSource(stored === "remote" ? "remote" : "local");
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

  // Persist CRT preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CRT_PREF_KEY, crtEnabled ? "true" : "false");
  }, [crtEnabled]);

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
      setChannel(channelId);
      triggerChannelOverlay(channelInfo);
      setRefreshToken((token) => token + 1);
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
        setMuted((prev) => !prev);
        return;
      }

      if (key === "c") {
        event.preventDefault();
        setCrtEnabled((prev) => !prev);
        return;
      }

      if (key === "f") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }

      if (key === "i") {
        event.preventDefault();
        setShowChannelInfo((prev) => !prev);
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

      if (!/^[1-9]$/.test(key)) return;
      const channelIds = channels.map(c => c.id);
      if (!channelIds.includes(key)) return;
      switchToChannel(key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [channels, channel]);

  const resolvedSrc = (np: NowPlaying | null) =>
    np ? withMediaSource(np, mediaSource).src : "";

  // Normalize channels to ChannelInfo format (handles legacy string[] responses)
  const normalizeChannels = (channels: unknown): ChannelInfo[] => {
    if (!Array.isArray(channels)) return [];
    return channels.map((ch) => {
      if (typeof ch === "string") {
        return { id: ch };
      }
      if (ch && typeof ch === "object" && typeof (ch as ChannelInfo).id === "string") {
        return ch as ChannelInfo;
      }
      return null;
    }).filter(Boolean) as ChannelInfo[];
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
          // Auto-select first channel if none selected or current channel no longer exists
          const channelIds = channelList.map(c => c.id);
          if (channelList.length > 0) {
            if (!channel || !channelIds.includes(channel)) {
              const firstChannel = channelList[0];
              setChannel(firstChannel.id);
              triggerChannelOverlay(firstChannel);
              setRefreshToken((token) => token + 1);
            }
          } else {
            // No channels available
            setChannel(null);
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
        return;
      }
      if (isWebkitFullscreen && videoWithWebkit.webkitExitFullscreen) {
        await videoWithWebkit.webkitExitFullscreen();
        return;
      }

      if (video.requestFullscreen) {
        await video.requestFullscreen();
        video.focus();
        return;
      }
      if (videoWithWebkit.webkitEnterFullscreen) {
        await videoWithWebkit.webkitEnterFullscreen();
        video.focus();
        return;
      }
    } catch (err) {
      console.warn("Fullscreen toggle failed", err);
    }
  };

  const formatTimeRemaining = () => {
    if (!nowPlaying) return "";
    const msRemaining = nowPlaying.endsAt - Date.now();
    const seconds = Math.max(0, Math.round(msRemaining / 1000));
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const nowPlayingLabel = nowPlaying?.title || nowPlaying?.relPath || "Waiting for schedule";
  const overlayChannelId = overlayChannel?.id
    ? overlayChannel.id.toString().padStart(2, "0")
    : "";
  const closeWelcome = () => setShowWelcome(false);
  const closeChannelInfo = () => setShowChannelInfo(false);
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
          onClick={() => setCrtEnabled((c) => !c)}
          className={`inline-flex min-w-0 flex-1 basis-1/3 items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold transition sm:w-auto sm:flex-none ${
            crtEnabled
              ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
              : "border-white/15 bg-white/5 text-neutral-100 hover:border-white/30 hover:bg-white/10"
          }`}
        >
          CRT
        </button>
        <button
          onClick={() => setMuted((m) => !m)}
          aria-pressed={muted}
          className={`inline-flex min-w-0 flex-1 basis-1/3 items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold transition sm:w-auto sm:flex-none ${
            muted
              ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
              : "border-white/15 bg-white/5 text-neutral-100 hover:border-white/30 hover:bg-white/10"
          }`}
        >
          {muted ? "Muted" : "Mute"}
        </button>
        <button
          onClick={toggleFullscreen}
          className="inline-flex min-w-0 flex-1 basis-1/3 items-center justify-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-center text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 sm:w-auto sm:flex-none"
        >
          {isFullscreen ? "Exit" : "Fullscreen"}
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

  // Show loading state while checking auth
  if (passwordRequired === null) {
    return (
      <div className="bg-black text-neutral-100 min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-neutral-400">Checking authentication...</div>
          {authCheckError && (
            <div className="text-sm text-red-400">{authCheckError}</div>
          )}
        </div>
      </div>
    );
  }

  // Show password modal if authentication is required
  if (!isAuthed && passwordRequired) {
    return (
      <div className="bg-black text-neutral-100 min-h-screen">
        <PasswordModal open={true} onSuccess={handleAuthSuccess} />
      </div>
    );
  }

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
              {/* Blue screen fallback when channel is selected but video is loading or nothing scheduled */}
              {channel && (!nowPlaying || isVideoLoading) && (
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
                playsInline
                controls={false}
                disablePictureInPicture
                disableRemotePlayback
                controlsList="nodownload noremoteplayback noplaybackrate nofullscreen"
                onContextMenu={(e) => e.preventDefault()}
                tabIndex={0}
                className={`relative z-[1] bg-black ${
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

              {/* Desktop overlay remote (md+) */}
              {showControls && !isFullscreen && (
                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-[4vh] z-20 justify-center px-4 ${
                    // In chromeless mode the player fills the viewport, so we always overlay
                    // (under-player would be clipped by overflow-hidden).
                    isChromeless ? "flex" : "hidden md:flex"
                  }`}
                >
                  <div className="pointer-events-auto w-full max-w-3xl rounded-xl border border-white/15 bg-black/60 p-2 shadow-2xl shadow-black/40 backdrop-blur">
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
                    {ch.id}{ch.shortName ? ` - ${ch.shortName}` : ""}
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
            <li className="flex justify-between gap-4"><span>Channel up</span><span className="font-mono text-neutral-100">↑</span></li>
            <li className="flex justify-between gap-4"><span>Channel down</span><span className="font-mono text-neutral-100">↓</span></li>
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

function withMediaSource(entry: NowPlaying, mediaSource: MediaSource): NowPlaying {
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

