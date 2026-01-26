"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";
import { ChannelSchedule, PlaylistItem, validateChannelSchedule } from "@/lib/schedule";

type MediaFile = {
  relPath: string;
  title: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  videoCodec?: string;
  audioCodec?: string;
};

type ChannelInfo = {
  id: string;
  shortName?: string;
  type?: "24hour" | "looping";
};

export default function ChannelPlaylistPage() {
  const params = useParams();
  const channelId = params.channel as string;
  
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  
  // Modal state - media files loaded lazily
  const [showAddModal, setShowAddModal] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaFilter, setMediaFilter] = useState("");
  
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedPlaylistRef = useRef<string>("[]");

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

  // Load just the channel's playlist (fast!)
  useEffect(() => {
    if (!channelId) return;
    
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadPlaylist = async () => {
      try {
        // Fetch channel info and playlist in parallel
        const [channelsRes, scheduleRes] = await Promise.all([
          fetch(`/api/channels?source=${encodeURIComponent(mediaSource)}`),
          fetch(`/api/channels/${encodeURIComponent(channelId)}/schedule?source=${encodeURIComponent(mediaSource)}`),
        ]);
        
        const channelsJson = await channelsRes.json();
        const scheduleJson = await scheduleRes.json();
        
        if (cancelled) return;
        
        // Find this channel's info
        const channels: ChannelInfo[] = channelsJson.channels || [];
        const info = channels.find(c => c.id === channelId);
        
        if (!info) {
          setError(`Channel "${channelId}" not found`);
          setLoading(false);
          return;
        }
        
        if (info.type !== "looping") {
          setError(`Channel "${channelId}" is not a looping channel`);
          setLoading(false);
          return;
        }
        
        setChannelInfo(info);
        
        const items = scheduleJson?.schedule?.playlist ?? [];
        const normalized = Array.isArray(items) ? items : [];
        setPlaylist(normalized);
        lastSavedPlaylistRef.current = JSON.stringify(normalized);
        
      } catch {
        if (!cancelled) setError("Failed to load playlist");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadPlaylist();
    return () => { cancelled = true; };
  }, [channelId, mediaSource]);

  // Lazy-load media files only when modal opens
  const loadMediaFiles = useCallback(async () => {
    if (mediaFiles.length > 0) return; // Already loaded
    
    setLoadingMedia(true);
    try {
      let filesJson: { items?: MediaFile[] } = {};
      if (mediaSource === "remote") {
        const res = await fetch(
          `/api/media-index?base=${encodeURIComponent(REMOTE_MEDIA_BASE)}&t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (res.ok) filesJson = await res.json();
      } else {
        const res = await fetch(`/api/media-files?t=${Date.now()}`, { cache: "no-store" });
        filesJson = await res.json();
      }
      setMediaFiles(filesJson.items || []);
    } catch {
      console.warn("Failed to load media files");
    } finally {
      setLoadingMedia(false);
    }
  }, [mediaSource, mediaFiles.length]);

  const openAddModal = useCallback(() => {
    setShowAddModal(true);
    setMediaFilter("");
    void loadMediaFiles();
  }, [loadMediaFiles]);

  const sortedFiles = useMemo(
    () => [...mediaFiles].sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" })),
    [mediaFiles]
  );

  // Only files with verified durations and browser support
  const availableFiles = useMemo(() => {
    const query = mediaFilter.trim().toLowerCase();
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];
    return sortedFiles.filter((file) => {
      if (!file.durationSeconds || file.durationSeconds <= 0) return false;
      if (!isBrowserSupported(file)) return false;
      if (!terms.length) return true;
      const haystack = `${file.relPath} ${file.title || ""}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [mediaFilter, sortedFiles]);

  const totalDuration = useMemo(() => 
    playlist.reduce((sum, item) => sum + item.durationSeconds, 0),
    [playlist]
  );

  // Save function
  const doSave = useCallback(async (playlistToSave: PlaylistItem[]) => {
    const body: ChannelSchedule = { type: "looping", playlist: playlistToSave };
    
    try {
      validateChannelSchedule(body);
    } catch {
      return false;
    }

    try {
      const url = mediaSource === "remote"
        ? `/api/channels/${encodeURIComponent(channelId)}/schedule?source=remote`
        : `/api/channels/${encodeURIComponent(channelId)}/schedule`;

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      
      if (!res.ok) return false;
      lastSavedPlaylistRef.current = JSON.stringify(playlistToSave);
      return true;
    } catch {
      return false;
    }
  }, [mediaSource, channelId]);

  // Auto-save effect
  useEffect(() => {
    if (loading) return;

    const current = JSON.stringify(playlist);
    
    if (current === lastSavedPlaylistRef.current) {
      setAutoSaveStatus("idle");
      return;
    }

    setAutoSaveStatus("pending");

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    const savePlaylist = playlist;
    
    autoSaveTimeoutRef.current = setTimeout(() => {
      setAutoSaveStatus("saving");
      void doSave(savePlaylist).then((success) => {
        if (success) {
          setAutoSaveStatus("saved");
          setTimeout(() => setAutoSaveStatus("idle"), 1500);
        } else {
          setAutoSaveStatus("idle");
        }
      });
    }, 800);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [playlist, loading, doSave]);

  const addToPlaylist = useCallback((file: MediaFile) => {
    if (!file.durationSeconds || file.durationSeconds <= 0) {
      setError("Cannot add file without verified duration");
      return;
    }
    const newItem: PlaylistItem = {
      file: file.relPath,
      title: file.title,
      durationSeconds: file.durationSeconds,
    };
    setPlaylist(prev => [...prev, newItem]);
  }, []);

  const addAllToPlaylist = useCallback(() => {
    const filesToAdd = availableFiles.filter(
      file => !playlist.some(item => item.file === file.relPath)
    );
    if (filesToAdd.length > 0) {
      const newItems: PlaylistItem[] = filesToAdd.map(file => ({
        file: file.relPath,
        title: file.title,
        durationSeconds: file.durationSeconds,
      }));
      setPlaylist(prev => [...prev, ...newItems]);
    }
  }, [availableFiles, playlist]);

  const removeFromPlaylist = useCallback((index: number) => {
    setPlaylist(prev => prev.filter((_, i) => i !== index));
  }, []);

  const movePlaylistItem = useCallback((fromIndex: number, direction: "up" | "down") => {
    setPlaylist(prev => {
      const newList = [...prev];
      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= newList.length) return prev;
      [newList[fromIndex], newList[toIndex]] = [newList[toIndex], newList[fromIndex]];
      return newList;
    });
  }, []);

  const shufflePlaylist = useCallback(() => {
    if (playlist.length <= 1) return;
    
    setPlaylist(prev => {
      const shuffled = [...prev];
      // Fisher-Yates shuffle algorithm
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    });
  }, [playlist.length]);

  const clearPlaylist = async () => {
    const confirmed = window.confirm(`Clear playlist for "${channelId}"?`);
    if (!confirmed) return;

    const previousSaved = lastSavedPlaylistRef.current;
    lastSavedPlaylistRef.current = "[]";

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    setMessage(null);
    setError(null);
    setPlaylist([]);
    setAutoSaveStatus("saving");

    const success = await doSave([]);
    if (success) {
      setMessage("Playlist cleared");
      setAutoSaveStatus("saved");
      setTimeout(() => setAutoSaveStatus("idle"), 1500);
    } else {
      lastSavedPlaylistRef.current = previousSaved;
      setError("Failed to clear playlist");
      setAutoSaveStatus("idle");
    }
  };

  // Error state
  if (error && !channelInfo) {
    return (
      <div className="flex flex-col gap-6 text-neutral-100">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">Playlist Admin</p>
          <p className="text-sm text-neutral-400">Channel: {channelId}</p>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
          <p className="text-red-200">{error}</p>
          <Link href="/admin/playlist" className="text-sm text-red-300 underline mt-2 inline-block">
            ← Back to channel list
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/admin/playlist" className="text-neutral-400 hover:text-neutral-200 text-sm">
              ← Channels
            </Link>
          </div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">
            Playlist: {channelInfo?.shortName || channelId}
          </p>
          <p className="text-sm text-neutral-400">
            Looping playlist - items play continuously based on global clock.
          </p>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-semibold bg-purple-500/20 text-purple-200">
          Looping
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={openAddModal}
          className="rounded-md border border-purple-400/60 bg-purple-500/20 px-3 py-1 text-sm font-semibold text-purple-50 transition hover:border-purple-300 hover:bg-purple-500/30"
          disabled={loading || autoSaveStatus === "saving"}
        >
          + Add to playlist
        </button>
        <button
          onClick={shufflePlaylist}
          className="rounded-md border border-blue-400/60 bg-blue-500/20 px-3 py-1 text-sm font-semibold text-blue-50 transition hover:border-blue-300 hover:bg-blue-500/30 disabled:opacity-50"
          disabled={loading || autoSaveStatus === "saving" || playlist.length <= 1}
          title="Randomize playlist order"
        >
          🔀 Shuffle
        </button>
        <button
          onClick={() => void clearPlaylist()}
          className="rounded-md border border-red-400/60 bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-50 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
          disabled={loading || autoSaveStatus === "saving" || playlist.length === 0}
        >
          Clear playlist
        </button>
        
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium transition-all ${
              loading
                ? "bg-blue-500/20 text-blue-200 border border-blue-400/30"
                : autoSaveStatus === "saving"
                  ? "bg-blue-500/20 text-blue-200 border border-blue-400/30"
                  : autoSaveStatus === "saved"
                    ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/30"
                    : autoSaveStatus === "pending"
                      ? "bg-amber-500/20 text-amber-200 border border-amber-400/30"
                      : "bg-neutral-500/20 text-neutral-300 border border-neutral-400/20"
            }`}
          >
            {loading || autoSaveStatus === "saving" ? (
              <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
            ) : autoSaveStatus === "saved" ? (
              <span className="text-emerald-300">✓</span>
            ) : autoSaveStatus === "pending" ? (
              <span className="h-2 w-2 rounded-full bg-current" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-current opacity-50" />
            )}
            
            {loading
              ? "Loading…"
              : autoSaveStatus === "saving"
                ? mediaSource === "remote" ? "Saving & pushing…" : "Saving…"
                : autoSaveStatus === "saved"
                  ? mediaSource === "remote" ? "Saved & pushed" : "Saved"
                  : autoSaveStatus === "pending"
                    ? "Unsaved changes"
                    : "Ready"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-8 text-center">
          <div className="inline-flex items-center gap-2 text-neutral-300">
            <span className="h-4 w-4 rounded-full border-2 border-neutral-400 border-t-transparent animate-spin" />
            <span className="text-sm">Loading playlist…</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Playlist info */}
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
            <div className="flex items-start gap-3">
              <span className="text-purple-300 text-lg">🔁</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-purple-200">Looping Playlist</p>
                <p className="text-xs text-purple-300/80 mt-1">
                  Total duration: <span className="font-semibold">{formatDuration(totalDuration)}</span>
                  {totalDuration > 0 && <> • Loops every {formatDuration(totalDuration)}</>}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
            {playlist.length === 0 ? (
              <p className="text-sm text-neutral-300">
                No items in playlist yet. Add media to build your loop.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-white/10 bg-neutral-950/50">
                <table className="min-w-full text-sm">
                  <thead className="bg-white/5 text-neutral-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold w-16">#</th>
                      <th className="px-3 py-2 text-left font-semibold">File</th>
                      <th className="px-3 py-2 text-right font-semibold w-28">Duration</th>
                      <th className="px-3 py-2 text-right font-semibold w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {playlist.map((item, idx) => (
                      <tr key={idx} className="text-neutral-100 bg-neutral-950/60">
                        <td className="px-3 py-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/30 text-xs font-semibold text-purple-200">
                            {idx + 1}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-sm break-all text-neutral-100">
                              {item.file}
                            </span>
                            {item.title && item.title !== item.file && (
                              <span className="text-[11px] text-neutral-400">{item.title}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-neutral-300">
                          {formatDuration(item.durationSeconds)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => movePlaylistItem(idx, "up")}
                              disabled={idx === 0}
                              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-200 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-30"
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => movePlaylistItem(idx, "down")}
                              disabled={idx === playlist.length - 1}
                              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-200 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-30"
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => removeFromPlaylist(idx)}
                              className="rounded-md border border-red-400/50 bg-red-500/20 px-2 py-1 text-xs text-red-200 transition hover:border-red-300 hover:bg-red-500/30"
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && channelInfo && <p className="text-sm text-amber-300">{error}</p>}

      {/* Add to Playlist Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-white/15 bg-neutral-900 p-5 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-neutral-100">Add to Playlist</h4>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs text-neutral-100 hover:bg-white/20"
              >
                Close
              </button>
            </div>

            <p className="mt-2 text-xs text-neutral-400">
              Only files with verified durations can be added to looping playlists.
            </p>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm text-neutral-300">Available Media</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Filter media…"
                    value={mediaFilter}
                    onChange={(e) => setMediaFilter(e.target.value)}
                    className="w-48 rounded-md bg-neutral-900 border border-white/10 px-2 py-1 text-sm focus:border-white/30 focus:outline-none"
                  />
                  <span className="text-xs text-neutral-500">
                    {loadingMedia ? "Loading…" : `${availableFiles.length} files`}
                  </span>
                  <button
                    onClick={addAllToPlaylist}
                    disabled={loadingMedia || availableFiles.filter(f => !playlist.some(item => item.file === f.relPath)).length === 0}
                    className="rounded-md border border-purple-400/50 bg-purple-500/20 px-2 py-1 text-xs font-semibold text-purple-100 transition hover:border-purple-300 hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={mediaFilter ? `Add all ${availableFiles.filter(f => !playlist.some(item => item.file === f.relPath)).length} filtered files` : "Add all files"}
                  >
                    Add all
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-white/10 bg-neutral-950/80">
                <div className="max-h-80 overflow-auto">
                  {loadingMedia ? (
                    <div className="p-8 text-center">
                      <div className="inline-flex items-center gap-2 text-neutral-400">
                        <span className="h-4 w-4 rounded-full border-2 border-neutral-500 border-t-transparent animate-spin" />
                        <span className="text-sm">Loading media library…</span>
                      </div>
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-white/5 text-neutral-200 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">File</th>
                          <th className="px-3 py-2 text-right font-semibold w-24">Duration</th>
                          <th className="px-3 py-2 text-right font-semibold w-20">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {availableFiles.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-4 text-center text-neutral-400">
                              {sortedFiles.length === 0
                                ? "No media files available"
                                : mediaFilter
                                  ? "No matches — adjust filter"
                                  : "No files with verified durations"
                              }
                            </td>
                          </tr>
                        ) : (
                          availableFiles.map((file) => {
                            const alreadyInPlaylist = playlist.some(item => item.file === file.relPath);
                            return (
                              <tr key={file.relPath} className="hover:bg-white/5">
                                <td className="px-3 py-2">
                                  <p className="font-mono text-xs break-all text-neutral-100">
                                    {file.relPath}
                                  </p>
                                  {file.title && file.title !== file.relPath && (
                                    <p className="text-[11px] text-neutral-400">{file.title}</p>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right text-neutral-300">
                                  {formatDuration(file.durationSeconds)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() => addToPlaylist(file)}
                                    disabled={alreadyInPlaylist}
                                    className={`rounded-md border px-2 py-1 text-xs font-semibold transition ${
                                      alreadyInPlaylist
                                        ? "border-neutral-500/50 bg-neutral-500/20 text-neutral-400 cursor-not-allowed"
                                        : "border-purple-400/50 bg-purple-500/20 text-purple-100 hover:border-purple-300 hover:bg-purple-500/30"
                                    }`}
                                  >
                                    {alreadyInPlaylist ? "Added" : "Add"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Current playlist summary */}
              <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
                <div className="flex justify-between text-xs">
                  <span className="text-purple-300">Current playlist</span>
                  <span className="text-purple-100">
                    {playlist.length} item{playlist.length !== 1 ? "s" : ""} • {formatDuration(totalDuration)} total
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
              >
                Done
              </button>
            </div>
          </div>
        </div>
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

const UNSUPPORTED_AUDIO_CODECS = [
  "ac3", "eac3", "dts", "truehd", "dts-hd", "dtshd",
  "pcm_s16le", "pcm_s24le", "pcm_s32le", "flac",
];

function hasUnsupportedAudio(file: MediaFile): boolean {
  if (!file.audioCodec) return false;
  const codec = file.audioCodec.toLowerCase();
  return UNSUPPORTED_AUDIO_CODECS.some((unsupported) => codec.includes(unsupported));
}

function isBrowserSupported(file: MediaFile): boolean {
  if (hasUnsupportedAudio(file)) return false;
  return file.supported || file.supportedViaCompanion;
}
