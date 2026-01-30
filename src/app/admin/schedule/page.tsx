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

export default function ScheduleIndexPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Start with null - wait for localStorage sync before loading data
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);

  // Load media source from localStorage - must complete before loading data
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

  // Load just channel list (fast!)
  useEffect(() => {
    // Wait for mediaSource to be synced from localStorage
    if (mediaSource === null) return;
    
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

  const scheduleChannels = useMemo(() =>
    channels.filter(c => c.type !== "looping"),
    [channels]
  );

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">Schedule Admin</p>
          <p className="text-sm text-neutral-400">
            Select a 24-hour channel to manage its schedule.
          </p>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-semibold bg-blue-500/20 text-blue-200">
          24-Hour
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
      ) : scheduleChannels.length === 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
          <p className="text-amber-200">No 24-hour channels found.</p>
          <p className="text-sm text-amber-300/70 mt-2">
            Create a 24-hour channel in the <Link href="/admin/channels" className="underline">Channels</Link> page first.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scheduleChannels.map((channel) => (
            <Link
              key={channel.id}
              href={`/admin/schedule/${encodeURIComponent(channel.id)}`}
              className="group rounded-xl border border-blue-500/30 bg-blue-500/10 p-5 transition hover:border-blue-400/50 hover:bg-blue-500/20"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-lg font-semibold text-blue-100 group-hover:text-white">
                    {channel.shortName || `Channel ${channel.id}`}
                  </p>
                  <p className="text-sm text-blue-300/70 mt-1">
                    ID: {channel.id}
                  </p>
                </div>
                <span className="text-blue-300 text-xl">📅</span>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-blue-300/60">
                  {channel.scheduledCount ?? 0} item{(channel.scheduledCount ?? 0) !== 1 ? "s" : ""} scheduled
                </span>
                <span className="text-xs text-blue-200 group-hover:text-white">
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
          <span className="text-neutral-300 font-medium">Tip:</span> 24-hour schedules play items at specific times each day (UTC).
          For continuous looping playlists, use the <Link href="/admin/playlist" className="underline">Playlist</Link> page.
        </p>
      </div>
    </div>
  );
}
