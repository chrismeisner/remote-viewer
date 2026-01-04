"use client";

import { useEffect, useRef, useState } from "react";
import {
  MEDIA_SOURCE_KEY,
  type MediaSource,
  REMOTE_MEDIA_BASE,
} from "@/constants/media";

type NowPlaying = {
  title: string;
  relPath: string;
  durationSeconds: number;
  startOffsetSeconds: number;
  endsAt: number;
  src: string;
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(false);
  const previousNowPlayingRef = useRef<NowPlaying | null>(null);
  const lastResolvedAtRef = useRef<number | null>(null);
  const lastRttMsRef = useRef<number>(0);
  const desiredOffsetRef = useRef<number | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>(
    REMOTE_MEDIA_BASE ? "remote" : "local",
  );
  const [channel, setChannel] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const initialChannelSet = useRef(false);
  
  // Channel overlay state for CRT-style display
  const [showChannelOverlay, setShowChannelOverlay] = useState(false);
  const [overlayChannel, setOverlayChannel] = useState<ChannelInfo | null>(null);
  const overlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Reset playback context when channel changes to ensure fresh offsets.
  useEffect(() => {
    previousNowPlayingRef.current = null;
    setNowPlaying(null);
    lastResolvedAtRef.current = null;
    lastRttMsRef.current = 0;
  }, [channel]);

  // Show channel overlay when channel changes
  const triggerChannelOverlay = (channelInfo: ChannelInfo) => {
    // Clear any existing timeout
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
    }
    
    setOverlayChannel(channelInfo);
    setShowChannelOverlay(true);
    
    // Hide overlay after 2 seconds
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

  // Load media source preference from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
    if (stored === "remote" || stored === "local") {
      setMediaSource(stored);
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
        const data = (await res.json()) as NowPlaying;
        if (!cancelled) {
          console.log("[player] now-playing fetched", {
            channel,
            title: data?.title,
            relPath: data?.relPath,
            startOffsetSeconds: data?.startOffsetSeconds,
            endsAt: data?.endsAt,
            fetchedAt: new Date().toISOString(),
            serverTimeMs: data?.serverTimeMs,
          });
          const resolvedAt = Date.now();
          lastResolvedAtRef.current = resolvedAt;
          lastRttMsRef.current = Math.max(0, resolvedAt - startedAt);
          setNowPlaying(withMediaSource(data, mediaSource));
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Unable to resolve current playback";
          setError(message);
          setNowPlaying(null);
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

    const handleLoaded = () => {
      video.muted = muted;
      const desiredTime = seekToDesired();
      console.log("[player] new media load", {
        channel,
        relPath: nowPlaying.relPath,
        startOffsetSeconds: nowPlaying.startOffsetSeconds,
        desiredTime,
        at: new Date().toISOString(),
      });
      video
        .play()
        .then(() => {
          console.log("[player] autoplay started");
        })
        .catch((err) => {
          console.warn("Autoplay failed", err);
        });
    };

    video.src = nowPlaying.src;
    video.preload = "auto";
    video.load();
    video.addEventListener("loadedmetadata", handleLoaded);
    const lateSeek = setTimeout(() => ensureSeeked(0), 300);
    previousNowPlayingRef.current = nowPlaying;

    return () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      clearTimeout(lateSeek);
    };
  }, [nowPlaying, muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
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

      if (!/^[1-9]$/.test(key)) return;
      const channelIds = channels.map(c => c.id);
      if (!channelIds.includes(key)) return;
      switchToChannel(key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [channels]);

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
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (video.requestFullscreen) {
        await video.requestFullscreen();
      } else {
        // @ts-expect-error vendor-prefixed fallback for WebKit
        await video.webkitRequestFullscreen?.();
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-xs text-slate-300 shadow-lg shadow-black/30">
          <div className="flex items-center gap-2">
            <label className="text-slate-400">Channel</label>
            {channels.length === 0 ? (
              <span className="text-slate-500 italic">No channels available</span>
            ) : (
              <select
                className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-slate-100"
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
          <span className="hidden sm:inline text-slate-400">
            Source: {mediaSource === "remote" ? "Remote CDN" : "Local files"}
          </span>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5 shadow-lg shadow-black/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-50">
                {nowPlaying?.relPath || nowPlaying?.title || "Waiting for schedule"}
              </p>
            </div>
          </div>

          <div
            className={`relative mt-4 overflow-hidden rounded-lg border border-white/10 bg-black ${crtEnabled ? "crt-frame" : ""}`}
          >
            {/* Blue screen fallback when channel is selected but nothing is playing */}
            {channel && !nowPlaying && (
              <div 
                className="aspect-video w-full"
                style={{ backgroundColor: "#0000FF" }}
              />
            )}
            
            {/* Video element - hidden when showing blue screen */}
            <video
              ref={videoRef}
              key={`${channel}-${resolvedSrc(nowPlaying) || "none"}`}
              autoPlay
              playsInline
              className={`relative z-[1] aspect-video w-full bg-black ${
                channel && !nowPlaying ? "hidden" : ""
              }`}
            />
            
            {/* CRT-style channel overlay */}
            <div
              className={`absolute top-4 left-4 z-10 transition-opacity duration-500 ${
                showChannelOverlay ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <div className="channel-overlay font-mono">
                <span className="channel-number">{overlayChannel?.id || ""}</span>
                {overlayChannel?.shortName && (
                  <span className="channel-name">{overlayChannel.shortName}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-row justify-center gap-2">
            <button
              onClick={() => setCrtEnabled((c) => !c)}
              className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${
                crtEnabled
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                  : "border-white/15 bg-white/5 text-slate-100 hover:border-white/30 hover:bg-white/10"
              }`}
            >
              CRT {crtEnabled ? "On" : "Off"}
            </button>
            <button
              onClick={() => setMuted((m) => !m)}
              aria-pressed={muted}
              className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${
                muted
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                  : "border-white/15 bg-white/5 text-slate-100 hover:border-white/30 hover:bg-white/10"
              }`}
            >
              Muted {muted ? "On" : "Off"}
            </button>
            <button
              onClick={toggleFullscreen}
              className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
            >
              {isFullscreen ? "Exit" : "Fullscreen"}
            </button>
          </div>

          {!nowPlaying && (
            <p className="mt-3 text-sm text-slate-400">
              {channels.length === 0
                ? "No channels configured. Create a channel in the admin panel to begin."
                : "No scheduled content. Add programs in the Schedule Admin."}
            </p>
          )}
        </div>

      </main>
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

