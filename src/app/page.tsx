"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_CHANNEL } from "@/constants/channels";
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

const POLL_INTERVAL_MS = 30_000;

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [loading, setLoading] = useState(false);
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
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [channels, setChannels] = useState<string[]>(["default"]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const initialChannelSet = useRef(false);
  // Reset playback context when channel changes to ensure fresh offsets.
  useEffect(() => {
    previousNowPlayingRef.current = null;
    setNowPlaying(null);
    lastResolvedAtRef.current = null;
    lastRttMsRef.current = 0;
  }, [channel]);

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
    let cancelled = false;
    const loadNowPlaying = async () => {
      const startedAt = Date.now();
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/now-playing?channel=${encodeURIComponent(channel)}`,
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
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadNowPlaying();
    const interval = setInterval(loadNowPlaying, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshToken, channel]);

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

  // Keyboard shortcuts: number keys 2-9 jump to matching channel name (if present).
  // "m" toggles mute, "f" toggles fullscreen.
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

      if (key === "f") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }

      if (!/^[2-9]$/.test(key)) return;
      if (!channels.includes(key)) return;
      setChannel(key);
      setRefreshToken((token) => token + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [channels]);

  const handleReload = () => {
    setRefreshToken((token) => token + 1);
  };

  const resolvedSrc = (np: NowPlaying | null) =>
    np ? withMediaSource(np, mediaSource).src : "";

  useEffect(() => {
    let cancelled = false;
    const loadChannels = async () => {
      setLoadingChannels(true);
      try {
        const res = await fetch("/api/channels");
        if (!res.ok) throw new Error("Failed to load channels");
        const data = await res.json();
        const names =
          Array.isArray(data.channels) && data.channels.length > 0
            ? data.channels
            : [DEFAULT_CHANNEL];
        if (!cancelled) {
          setChannels(names);
          if (!initialChannelSet.current && names.length > 0) {
            setChannel(names[0]);
            setRefreshToken((token) => token + 1);
            initialChannelSet.current = true;
          } else if (!names.includes(channel)) {
            const next = names.includes(DEFAULT_CHANNEL) ? DEFAULT_CHANNEL : names[0];
            setChannel(next);
            setRefreshToken((token) => token + 1);
          }
        }
      } catch (err) {
        console.warn("Channel list error", err);
        if (!cancelled) {
          setChannels([DEFAULT_CHANNEL]);
          if (channel !== DEFAULT_CHANNEL) {
            setChannel(DEFAULT_CHANNEL);
            setRefreshToken((token) => token + 1);
          }
        }
      } finally {
        if (!cancelled) setLoadingChannels(false);
      }
    };

    loadChannels();
    return () => {
      cancelled = true;
    };
  }, []);

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
            <select
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-slate-100"
              value={channel}
              onChange={(e) => {
                const next = e.target.value;
                setChannel(next);
                setRefreshToken((token) => token + 1);
              }}
              disabled={loadingChannels}
            >
              {channels.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <span className="hidden sm:inline text-slate-400">
            Point your media folder to the library you want to serve
          </span>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5 shadow-lg shadow-black/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Now Playing
              </p>
              <h2 className="text-xl font-semibold text-slate-50">
                {nowPlaying?.title || "Waiting for schedule"}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
                  Channel: {channel}
                </span>
              </div>
              {nowPlaying?.relPath && (
                <p className="text-sm text-slate-400">{nowPlaying.relPath}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {nowPlaying && (
                <div className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200">
                  {formatTimeRemaining()} left
                </div>
              )}
              <button
                onClick={handleReload}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
                disabled={loading}
              >
                {loading ? "Loading…" : "Reload"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3 text-xs text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-white/30 bg-black/40"
                checked={crtEnabled}
                onChange={(e) => setCrtEnabled(e.target.checked)}
              />
              CRT filter
            </label>
          </div>

          <div
            className={`relative mt-3 overflow-hidden rounded-lg border border-white/10 bg-black ${crtEnabled ? "crt-frame" : ""}`}
          >
            <video
              ref={videoRef}
              key={`${channel}-${resolvedSrc(nowPlaying) || "none"}`}
              autoPlay
              playsInline
              className="relative z-[1] aspect-video w-full bg-black"
            />
            <div className="absolute right-3 top-3 hidden flex-row gap-2 sm:flex">
              <button
                onClick={() => setMuted((m) => !m)}
                className="rounded-full border border-white/20 bg-black/50 px-3 py-1 text-xs font-semibold text-slate-50 shadow-sm transition hover:border-white/40 hover:bg-black/70"
              >
                Sound: {muted ? "Off" : "On"}
              </button>
              <button
                onClick={toggleFullscreen}
                className="rounded-full border border-white/20 bg-black/50 px-3 py-1 text-xs font-semibold text-slate-50 shadow-sm transition hover:border-white/40 hover:bg-black/70"
              >
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
            <button
              onClick={() => setMuted((m) => !m)}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={toggleFullscreen}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
            >
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          </div>

          {error && (
            <p className="mt-3 text-sm text-amber-300">
              {error}. Check your media folder path and schedule content.
            </p>
          )}
          {!error && !nowPlaying && (
            <p className="mt-3 text-sm text-slate-400">
              Add a slot in Schedule Admin to begin playback.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-300">
          <p className="font-semibold text-slate-100">How it works</p>
          <ul className="mt-2 space-y-1 text-slate-300">
            <li>A single 24h schedule maps times to media files from your library.</li>
            <li>Arriving mid-slot jumps you into the correct offset.</li>
            <li>Reload or wait ~30s to catch rollovers.</li>
          </ul>
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

