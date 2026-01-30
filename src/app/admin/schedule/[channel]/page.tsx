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
import { ChannelSchedule, ScheduleSlot, validateChannelSchedule } from "@/lib/schedule";

type ScheduleConflict = {
  slotAIndex: number;
  slotBIndex: number;
  slotA: ScheduleSlot;
  slotB: ScheduleSlot;
  overlapSeconds: number;
};

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

export default function ChannelSchedulePage() {
  const params = useParams();
  const channelId = params.channel as string;

  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Start with null - wait for localStorage sync before loading data
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saving" | "saved">("idle");

  // Modal state - media files loaded lazily
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [modalStart, setModalStart] = useState("00:00:00");
  const [modalEnd, setModalEnd] = useState("00:00:00");
  const [modalFile, setModalFile] = useState<string>("");
  const [mediaFilter, setMediaFilter] = useState("");
  const [supportedFilter, setSupportedFilter] = useState<"all" | "supported" | "unsupported">("supported");

  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedSlotsRef = useRef<string>("[]");
  const lastSuggestedEndRef = useRef<string>("");

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

  // Load just the channel's schedule (fast!)
  useEffect(() => {
    // Wait for mediaSource to be synced from localStorage
    if (mediaSource === null) return;
    
    if (!channelId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadSchedule = async () => {
      try {
        // Fetch channel info and schedule in parallel
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

        if (info.type === "looping") {
          setError(`Channel "${channelId}" is a looping channel. Use the Playlist page instead.`);
          setLoading(false);
          return;
        }

        setChannelInfo(info);

        const savedSlots = scheduleJson?.schedule?.slots ?? [];
        const normalizedSlots = Array.isArray(savedSlots) ? savedSlots : [];
        setSlots(normalizedSlots);
        lastSavedSlotsRef.current = JSON.stringify(normalizedSlots);

      } catch {
        if (!cancelled) setError("Failed to load schedule");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSchedule();
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

  const sortedFiles = useMemo(
    () => [...mediaFiles].sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" })),
    [mediaFiles]
  );

  const supportedFiles = useMemo(
    () => sortedFiles.filter((file) => isBrowserSupported(file)),
    [sortedFiles]
  );

  const filteredModalFiles = useMemo(() => {
    const query = mediaFilter.trim().toLowerCase();
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];
    return sortedFiles.filter((file) => {
      const browserSupported = isBrowserSupported(file);
      if (supportedFilter === "supported" && !browserSupported) return false;
      if (supportedFilter === "unsupported" && browserSupported) return false;
      if (!terms.length) return true;
      const haystack = `${file.relPath} ${file.title || ""}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [mediaFilter, sortedFiles, supportedFilter]);

  const modalPoolSize = useMemo(() => {
    if (supportedFilter === "supported") return supportedFiles.length;
    if (supportedFilter === "unsupported") return Math.max(0, sortedFiles.length - supportedFiles.length);
    return sortedFiles.length;
  }, [supportedFilter, supportedFiles.length, sortedFiles.length]);

  const fileByRel = useMemo(() => {
    const map = new Map<string, MediaFile>();
    for (const f of sortedFiles) map.set(f.relPath, f);
    return map;
  }, [sortedFiles]);

  const scheduleConflicts = useMemo(() => detectScheduleConflicts(slots), [slots]);

  const conflictingSlotIndices = useMemo(() => {
    const indices = new Set<number>();
    for (const conflict of scheduleConflicts) {
      indices.add(conflict.slotAIndex);
      indices.add(conflict.slotBIndex);
    }
    return indices;
  }, [scheduleConflicts]);

  const openAddModal = useCallback(() => {
    const defaultFile = supportedFiles[0]?.relPath || "";
    const nextStart = slots.length > 0
      ? incrementTime(slots[slots.length - 1].start, 60)
      : "00:00:00";
    setModalFile(defaultFile);
    setModalStart(nextStart);
    setModalEnd(computeEndTime(nextStart, defaultFile, sortedFiles));
    setMediaFilter("");
    setShowSlotModal(true);
    void loadMediaFiles();
  }, [supportedFiles, slots, sortedFiles, loadMediaFiles]);

  const scheduleNext = useCallback((slotEndTime: string) => {
    const defaultFile = supportedFiles[0]?.relPath || "";
    setModalFile(defaultFile);
    setModalStart(slotEndTime);
    setModalEnd(computeEndTime(slotEndTime, defaultFile, sortedFiles));
    setMediaFilter("");
    setShowSlotModal(true);
    void loadMediaFiles();
  }, [supportedFiles, sortedFiles, loadMediaFiles]);

  const setModalStartWithSuggestedTime = useCallback(
    (startValue: string) => {
      setModalStart(startValue);
      const suggestedEnd = computeEndTime(startValue, modalFile, sortedFiles);
      lastSuggestedEndRef.current = suggestedEnd;
      setModalEnd(suggestedEnd);
    },
    [modalFile, sortedFiles]
  );

  // Update suggested end time when file changes
  useEffect(() => {
    const suggested = computeEndTime(modalStart, modalFile, sortedFiles);
    const shouldUpdate = !isValidTime(modalEnd) || modalEnd === lastSuggestedEndRef.current;
    if (shouldUpdate && suggested !== modalEnd) {
      lastSuggestedEndRef.current = suggested;
      setModalEnd(suggested);
    } else {
      lastSuggestedEndRef.current = suggested;
    }
  }, [modalStart, modalFile, sortedFiles, modalEnd]);

  // Save function
  const doSave = useCallback(async (slotsToPersist: ScheduleSlot[]) => {
    const normalized = [...slotsToPersist].sort(
      (a, b) => timeToSeconds(a.start) - timeToSeconds(b.start)
    );
    const body: ChannelSchedule = { type: "24hour", slots: normalized };

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
      lastSavedSlotsRef.current = JSON.stringify(body.slots);
      return true;
    } catch {
      return false;
    }
  }, [mediaSource, channelId]);

  // Auto-save effect
  useEffect(() => {
    if (loading) return;

    const currentSlots = JSON.stringify(slots);

    if (currentSlots === lastSavedSlotsRef.current) {
      setAutoSaveStatus("idle");
      return;
    }

    setAutoSaveStatus("pending");

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    const saveSlots = slots;

    autoSaveTimeoutRef.current = setTimeout(() => {
      setAutoSaveStatus("saving");
      void doSave(saveSlots).then((success) => {
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
  }, [slots, loading, doSave]);

  const clearSchedule = async () => {
    const confirmed = window.confirm(`Clear schedule for "${channelId}"?`);
    if (!confirmed) return;

    const previousSaved = lastSavedSlotsRef.current;
    lastSavedSlotsRef.current = "[]";

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    setMessage(null);
    setError(null);
    setSlots([]);
    setAutoSaveStatus("saving");

    const success = await doSave([]);
    if (success) {
      setMessage("Schedule cleared");
      setAutoSaveStatus("saved");
      setTimeout(() => setAutoSaveStatus("idle"), 1500);
    } else {
      lastSavedSlotsRef.current = previousSaved;
      setError("Failed to clear schedule");
      setAutoSaveStatus("idle");
    }
  };

  const addSlotFromModal = useCallback(() => {
    if (!modalFile || !isValidTime(modalStart) || !isValidTime(modalEnd) || timeToSeconds(modalEnd) === timeToSeconds(modalStart)) return;
    
    const newSlot: ScheduleSlot = {
      start: modalStart,
      end: modalEnd,
      file: modalFile,
    };
    const nextSlots = [...slots, newSlot].sort(
      (a, b) => timeToSeconds(a.start) - timeToSeconds(b.start)
    );
    setSlots(nextSlots);
    setShowSlotModal(false);
  }, [modalFile, modalStart, modalEnd, slots]);

  // Error state
  if (error && !channelInfo) {
    return (
      <div className="flex flex-col gap-6 text-neutral-100">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">Schedule Admin</p>
          <p className="text-sm text-neutral-400">Channel: {channelId}</p>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
          <p className="text-red-200">{error}</p>
          <Link href="/admin/schedule" className="text-sm text-red-300 underline mt-2 inline-block">
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
            <Link href="/admin/schedule" className="text-neutral-400 hover:text-neutral-200 text-sm">
              ← Channels
            </Link>
          </div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">
            Schedule: {channelInfo?.shortName || channelId}
          </p>
          <p className="text-sm text-neutral-400">
            Single-day (24h, UTC) schedule. Changes auto-save.
          </p>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-semibold bg-blue-500/20 text-blue-200">
          24-Hour
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={openAddModal}
          className="rounded-md border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-neutral-50 transition hover:border-white/30 hover:bg-white/15"
          disabled={loading || autoSaveStatus === "saving"}
        >
          + Add schedule item
        </button>
        <button
          onClick={() => void clearSchedule()}
          className="rounded-md border border-red-400/60 bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-50 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
          disabled={loading || autoSaveStatus === "saving" || slots.length === 0}
        >
          Clear schedule
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
            <span className="text-sm">Loading schedule…</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Conflict warnings */}
          {scheduleConflicts.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <span className="text-amber-300 text-lg">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-200">
                    {scheduleConflicts.length} schedule conflict{scheduleConflicts.length !== 1 ? "s" : ""} detected
                  </p>
                  <p className="text-xs text-amber-300/80 mt-1">
                    Some time slots overlap. This may cause unexpected playback behavior.
                  </p>
                  <div className="mt-3 space-y-2">
                    {scheduleConflicts.slice(0, 5).map((conflict, idx) => (
                      <div key={idx} className="text-xs text-amber-100 bg-amber-500/10 rounded-md px-3 py-2">
                        <span className="font-mono">{conflict.slotA.start}–{conflict.slotA.end}</span>
                        {" "}overlaps with{" "}
                        <span className="font-mono">{conflict.slotB.start}–{conflict.slotB.end}</span>
                        <span className="text-amber-300/70 ml-2">({formatDuration(conflict.overlapSeconds)} overlap)</span>
                      </div>
                    ))}
                    {scheduleConflicts.length > 5 && (
                      <p className="text-xs text-amber-300/70">
                        ...and {scheduleConflicts.length - 5} more conflict{scheduleConflicts.length - 5 !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
            {slots.length === 0 ? (
              <p className="text-sm text-neutral-300">
                No schedule items yet. Add the first item to build a 24h schedule.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-white/10 bg-neutral-950/50">
                <table className="min-w-full text-sm">
                  <thead className="bg-white/5 text-neutral-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Start</th>
                      <th className="px-3 py-2 text-left font-semibold">End</th>
                      <th className="px-3 py-2 text-left font-semibold">File</th>
                      <th className="px-3 py-2 text-right font-semibold w-28">Duration</th>
                      <th className="px-3 py-2 text-right font-semibold w-28">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {slots
                      .map((slot, idx) => ({ slot, idx }))
                      .sort((a, b) => timeToSeconds(a.slot.start) - timeToSeconds(b.slot.start))
                      .map(({ slot, idx }) => {
                        const slotFileMeta = fileByRel.get(slot.file);
                        const slotIsSupported = slotFileMeta ? isBrowserSupported(slotFileMeta) : true;
                        const duration = slotFileMeta?.durationSeconds || 0;
                        const isMidnightCrossing = crossesMidnight(slot.start, slot.end);
                        const slotWindow = slotDurationSeconds(slot.start, slot.end);
                        const hasConflict = conflictingSlotIndices.has(idx);
                        return (
                          <tr key={idx} className={`text-neutral-100 ${
                            hasConflict
                              ? "bg-amber-950/40 border-l-2 border-l-amber-500"
                              : isMidnightCrossing
                                ? "bg-indigo-950/40"
                                : "bg-neutral-950/60"
                          }`}>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2 text-sm font-mono text-neutral-100">
                                <span>{slot.start}</span>
                                {isMidnightCrossing && (
                                  <span className="text-[10px] text-indigo-300" title="Crosses midnight">🌙</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2 text-sm font-mono text-neutral-100">
                                <span>{slot.end}</span>
                                {isMidnightCrossing && (
                                  <span className="text-[10px] text-indigo-300" title="Next day">+1d</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-1">
                                <span className={`font-mono text-sm break-all ${slotIsSupported ? "text-neutral-100" : "text-amber-200"}`}>
                                  {slot.file || "—"}
                                </span>
                                {!slotIsSupported && slot.file && (
                                  <span className="text-[11px] text-amber-300">Unsupported in browser</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-neutral-300">
                              <div className="flex flex-col items-end text-xs">
                                <span title="File duration">{duration ? formatDuration(duration) : "—"}</span>
                                {slotWindow !== duration && duration > 0 && (
                                  <span className="text-neutral-500" title="Slot window">
                                    ({formatDuration(slotWindow)} window)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => scheduleNext(slot.end)}
                                  className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-200 transition hover:border-white/30 hover:bg-white/10"
                                  title={`Schedule next item starting at ${slot.end}`}
                                >
                                  + Next
                                </button>
                                <button
                                  onClick={() => {
                                    const nextSlots = slots.filter((_, i) => i !== idx);
                                    setSlots(nextSlots);
                                  }}
                                  className="rounded-md border border-red-400/60 bg-red-500/20 px-2 py-1 text-xs text-red-50 transition hover:border-red-300 hover:bg-red-500/30"
                                  title="Delete this schedule item"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && channelInfo && <p className="text-sm text-amber-300">{error}</p>}

      {/* Add Schedule Item Modal */}
      {showSlotModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowSlotModal(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-white/15 bg-neutral-900 p-5 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-neutral-100">Add schedule item</h4>
              <button
                onClick={() => setShowSlotModal(false)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs text-neutral-100 hover:bg-white/20"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-neutral-200">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm text-neutral-300">Media</label>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                    <input
                      type="text"
                      placeholder="Filter media…"
                      value={mediaFilter}
                      onChange={(e) => setMediaFilter(e.target.value)}
                      className="w-48 rounded-md bg-neutral-900 border border-white/10 px-2 py-1 text-sm focus:border-white/30 focus:outline-none"
                    />
                    <div className="flex items-center gap-1 text-neutral-400">
                      <span>Supported</span>
                      <select
                        value={supportedFilter}
                        onChange={(e) => setSupportedFilter(e.target.value as "all" | "supported" | "unsupported")}
                        className="rounded-md border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                      >
                        <option value="supported">Supported</option>
                        <option value="unsupported">Unsupported</option>
                        <option value="all">All</option>
                      </select>
                    </div>
                    <span className="text-neutral-500">
                      {loadingMedia ? "Loading…" : `${filteredModalFiles.length}/${modalPoolSize}`}
                    </span>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-white/10 bg-neutral-950/80">
                  <div className="max-h-64 overflow-auto">
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
                            <th className="px-3 py-2 text-right font-semibold w-28">Support</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredModalFiles.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-3 py-3 text-center text-neutral-400">
                                {modalPoolSize === 0
                                  ? supportedFilter === "supported"
                                    ? "No supported files in library"
                                    : supportedFilter === "unsupported"
                                      ? "No unsupported files in library"
                                      : "No media files in library"
                                  : "No matches — adjust filter"}
                              </td>
                            </tr>
                          ) : (
                            filteredModalFiles.map((file) => {
                              const selected = modalFile === file.relPath;
                              const browserSupported = isBrowserSupported(file);
                              const supportLabel = browserSupported
                                ? file.supportedViaCompanion ? "Companion" : "Direct"
                                : hasUnsupportedAudio(file) ? "Unsupported (audio)" : "Unsupported";
                              const supportClass = browserSupported
                                ? file.supportedViaCompanion ? "bg-blue-500/20 text-blue-100" : "bg-emerald-500/20 text-emerald-100"
                                : "bg-amber-500/20 text-amber-100";
                              return (
                                <tr
                                  key={file.relPath}
                                  className={`cursor-pointer transition ${selected ? "bg-white/10" : "hover:bg-white/5"}`}
                                  onClick={() => setModalFile(file.relPath)}
                                >
                                  <td className="px-3 py-2">
                                    <div className="flex items-start gap-2">
                                      <input
                                        type="radio"
                                        className="mt-1 accent-emerald-400"
                                        checked={selected}
                                        onChange={() => setModalFile(file.relPath)}
                                      />
                                      <div className="space-y-1">
                                        <p className="font-mono text-xs break-all text-neutral-100">{file.relPath}</p>
                                        {file.title && file.title !== file.relPath && (
                                          <p className="text-[11px] text-neutral-400">{file.title}</p>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right text-neutral-300">
                                    {formatDuration(file.durationSeconds)}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <span className={`rounded-full px-2 py-1 text-[11px] ${supportClass}`}>
                                      {supportLabel}
                                    </span>
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
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-neutral-300">
                  Start time
                  <input
                    type="time"
                    step="1"
                    value={modalStart}
                    onChange={(e) => setModalStartWithSuggestedTime(e.target.value)}
                    className="ml-2 rounded-md bg-neutral-900 border border-white/10 px-2 py-1 text-sm"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-neutral-300">
                  <span className="text-neutral-400">Quick set:</span>
                  <button
                    type="button"
                    onClick={() => setModalStartWithSuggestedTime(formatNowUtc())}
                    className="rounded-md border border-white/15 bg-white/5 px-2 py-1 font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalStartWithSuggestedTime(formatThisHourUtc())}
                    className="rounded-md border border-white/15 bg-white/5 px-2 py-1 font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                  >
                    This hour
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalStartWithSuggestedTime(formatNextHourUtc())}
                    className="rounded-md border border-white/15 bg-white/5 px-2 py-1 font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                  >
                    Next hour
                  </button>
                </div>
                <label className="text-xs text-neutral-300">
                  End time
                  <input
                    type="time"
                    step="1"
                    value={modalEnd}
                    onChange={(e) => setModalEnd(e.target.value)}
                    className="ml-2 rounded-md bg-neutral-900 border border-white/10 px-2 py-1 text-sm"
                  />
                </label>
                <div className="text-xs text-neutral-300">
                  Suggested end
                  {(() => {
                    const suggested = computeEndTimeWithIndicator(modalStart, modalFile, sortedFiles);
                    return (
                      <div className="mt-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-neutral-100 flex items-center gap-2">
                        {suggested.time}
                        {suggested.crossesMidnight && (
                          <span className="text-indigo-300" title="Crosses midnight">🌙 +1d</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {isValidTime(modalStart) && isValidTime(modalEnd) && crossesMidnight(modalStart, modalEnd) && (
                <p className="text-xs text-indigo-300">
                  🌙 This slot will cross midnight and continue into the next day.
                  <br />
                  <span className="text-indigo-400">
                    Slot window: {formatDuration(slotDurationSeconds(modalStart, modalEnd))}
                  </span>
                </p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSlotModal(false)}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={addSlotFromModal}
                disabled={!modalFile || !isValidTime(modalStart) || !isValidTime(modalEnd) || timeToSeconds(modalEnd) === timeToSeconds(modalStart)}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                Add schedule item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions
function timeToSeconds(value: string): number {
  const parts = value.split(":").map((n) => Number(n));
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return ((h * 60 + m) * 60 + s) % 86400;
}

function detectScheduleConflicts(slots: ScheduleSlot[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  if (slots.length < 2) return conflicts;

  const sortedSlots = slots
    .map((slot, idx) => ({ slot, originalIndex: idx }))
    .sort((a, b) => timeToSeconds(a.slot.start) - timeToSeconds(b.slot.start));

  for (let i = 0; i < sortedSlots.length; i++) {
    for (let j = i + 1; j < sortedSlots.length; j++) {
      const a = sortedSlots[i];
      const b = sortedSlots[j];
      const overlap = calculateOverlap(a.slot, b.slot);
      if (overlap > 0) {
        conflicts.push({
          slotAIndex: a.originalIndex,
          slotBIndex: b.originalIndex,
          slotA: a.slot,
          slotB: b.slot,
          overlapSeconds: overlap,
        });
      }
    }
  }
  return conflicts;
}

function calculateOverlap(slotA: ScheduleSlot, slotB: ScheduleSlot): number {
  const aStart = timeToSeconds(slotA.start);
  const aEnd = timeToSeconds(slotA.end);
  const bStart = timeToSeconds(slotB.start);
  const bEnd = timeToSeconds(slotB.end);

  const aCrosses = aEnd <= aStart;
  const bCrosses = bEnd <= bStart;

  const aRanges = aCrosses ? [[aStart, 86400], [0, aEnd]] : [[aStart, aEnd]];
  const bRanges = bCrosses ? [[bStart, 86400], [0, bEnd]] : [[bStart, bEnd]];

  let totalOverlap = 0;
  for (const [aS, aE] of aRanges) {
    for (const [bS, bE] of bRanges) {
      const overlapStart = Math.max(aS, bS);
      const overlapEnd = Math.min(aE, bE);
      if (overlapEnd > overlapStart) {
        totalOverlap += overlapEnd - overlapStart;
      }
    }
  }
  return totalOverlap;
}

function slotDurationSeconds(startTime: string, endTime: string): number {
  const startSec = timeToSeconds(startTime);
  const endSec = timeToSeconds(endTime);
  if (endSec > startSec) return endSec - startSec;
  return (86400 - startSec) + endSec;
}

function crossesMidnight(startTime: string, endTime: string): boolean {
  return timeToSeconds(endTime) < timeToSeconds(startTime);
}

function incrementTime(value: string, seconds: number): string {
  const total = (timeToSeconds(value) + seconds + 86400) % 86400;
  return secondsToTime(total);
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
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

function computeEndTime(start: string, file: string, files: MediaFile[]): string {
  if (!isValidTime(start) || !file) return "--:--:--";
  const dur = files.find((f) => f.relPath === file)?.durationSeconds || 0;
  const startSec = timeToSeconds(start);
  const endSec = (startSec + dur) % 86400;
  return secondsToTime(endSec);
}

function computeEndTimeWithIndicator(start: string, file: string, files: MediaFile[]): { time: string; crossesMidnight: boolean } {
  if (!isValidTime(start) || !file) return { time: "--:--:--", crossesMidnight: false };
  const dur = files.find((f) => f.relPath === file)?.durationSeconds || 0;
  const startSec = timeToSeconds(start);
  const endSec = (startSec + dur) % 86400;
  const crossesMidnight = startSec + dur >= 86400;
  return { time: secondsToTime(endSec), crossesMidnight };
}

function secondsToTime(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatNowUtc(): string {
  const now = new Date();
  return `${now.getUTCHours().toString().padStart(2, "0")}:${now.getUTCMinutes().toString().padStart(2, "0")}:${now.getUTCSeconds().toString().padStart(2, "0")}`;
}

function formatThisHourUtc(): string {
  const now = new Date();
  return `${now.getUTCHours().toString().padStart(2, "0")}:00:00`;
}

function formatNextHourUtc(): string {
  const now = new Date();
  const nextHour = (now.getUTCHours() + 1) % 24;
  return `${nextHour.toString().padStart(2, "0")}:00:00`;
}
