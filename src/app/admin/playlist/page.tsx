"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  type MediaSource,
} from "@/constants/media";

type ChannelInfo = {
  id: string;
  shortName?: string;
  type?: "24hour" | "looping";
  scheduledCount?: number;
};

export default function PlaylistIndexPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Initialize mediaSource from localStorage synchronously to avoid race condition
  const [mediaSource, setMediaSource] = useState<MediaSource>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      if (stored === "remote" || stored === "local") {
        return stored;
      }
    }
    return "local";
  });

  // Load media source from localStorage
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

  // Load just channel list (fast!)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadChannels = async () => {
      try {
        const res = await fetch(`/api/channels?source=${encodeURIComponent(mediaSource)}`);
        const json = await res.json();
        
        if (!cancelled) {
          const channelList: ChannelInfo[] = Array.isArray(json.channels)
            ? json.channels.map((ch: unknown) => {
                if (typeof ch === "string") return { id: ch };
                if (ch && typeof ch === "object" && typeof (ch as ChannelInfo).id === "string") {
                  return ch as ChannelInfo;
                }
                return null;
              }).filter(Boolean) as ChannelInfo[]
            : [];
          setChannels(channelList);
        }
      } catch {
        if (!cancelled) setError("Failed to load channels");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadChannels();
    return () => { cancelled = true; };
  }, [mediaSource]);

  const loopingChannels = useMemo(() => 
    channels.filter(c => c.type === "looping"),
    [channels]
  );

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">Playlist Admin</p>
          <p className="text-sm text-neutral-400">
            Select a looping channel to manage its playlist.
          </p>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-semibold bg-purple-500/20 text-purple-200">
          Looping
        </span>
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-8 text-center">
          <div className="inline-flex items-center gap-2 text-neutral-300">
            <span className="h-4 w-4 rounded-full border-2 border-neutral-400 border-t-transparent animate-spin" />
            <span className="text-sm">Loading channels…</span>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
          <p className="text-red-200">{error}</p>
        </div>
      ) : loopingChannels.length === 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
          <p className="text-amber-200">No looping channels found.</p>
          <p className="text-sm text-amber-300/70 mt-2">
            Create a looping channel in the <Link href="/admin/channels" className="underline">Channels</Link> page first.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loopingChannels.map((channel) => (
            <Link
              key={channel.id}
              href={`/admin/playlist/${encodeURIComponent(channel.id)}`}
              className="group rounded-xl border border-purple-500/30 bg-purple-500/10 p-5 transition hover:border-purple-400/50 hover:bg-purple-500/20"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-lg font-semibold text-purple-100 group-hover:text-white">
                    {channel.shortName || `Channel ${channel.id}`}
                  </p>
                  <p className="text-sm text-purple-300/70 mt-1">
                    ID: {channel.id}
                  </p>
                </div>
                <span className="text-purple-300 text-xl">🔁</span>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-purple-300/60">
                  {channel.scheduledCount ?? 0} item{(channel.scheduledCount ?? 0) !== 1 ? "s" : ""} in playlist
                </span>
                <span className="text-xs text-purple-200 group-hover:text-white">
                  Edit →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Quick tip */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-neutral-400">
          <span className="text-neutral-300 font-medium">Tip:</span> Looping playlists play continuously based on a global clock. 
          Everyone watching the same channel sees the same content at the same time.
        </p>
      </div>
    </div>
  );
}
