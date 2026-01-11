"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";
import { DailySchedule, ScheduleSlot, validateDailySchedule } from "@/lib/schedule";

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
  audioCodec?: string;
};

type ChannelInfo = {
  id: string;
  shortName?: string;
};

export default function ScheduleAdminPage() {
  return (
    <Suspense fallback={<div className="p-4 text-neutral-200">Loading...</div>}>
      <ScheduleAdminContent />
    </Suspense>
  );
}

function ScheduleAdminContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [modalStart, setModalStart] = useState("00:00:00");
  const [modalEnd, setModalEnd] = useState("00:00:00");
  const [modalFile, setModalFile] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [showFillModal, setShowFillModal] = useState(false);
  const [fillSelectedFiles, setFillSelectedFiles] = useState<string[]>([]);
  const [fillMediaFilter, setFillMediaFilter] = useState("");
  const [fillSupportedFilter, setFillSupportedFilter] = useState<"all" | "supported" | "unsupported">("supported");
  const [channel, setChannel] = useState<string | null>(
    () => searchParams.get("channel") || null,
  );
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  const [mediaFilter, setMediaFilter] = useState("");
  const [supportedFilter, setSupportedFilter] = useState<"all" | "supported" | "unsupported">("supported");
  const pendingSlotsRef = useRef<ScheduleSlot[] | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedSlotsRef = useRef<string>("");
  const lastSavedChannelRef = useRef<string | null>(null); // track which channel lastSavedSlotsRef belongs to
  const lastUrlChannelRef = useRef<string | null>(searchParams.get("channel"));
  const lastSuggestedEndRef = useRef<string>(""); // track auto-suggested end time

  const syncChannelParam = useCallback(
    (nextChannel: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextChannel) {
        params.set("channel", nextChannel);
      } else {
        params.delete("channel");
      }
      const query = params.toString();
      router.replace(query ? `?${query}` : "?", { scroll: false });
      lastUrlChannelRef.current = nextChannel;
    },
    [router, searchParams],
  );

  const handleChannelChange = useCallback(
    (nextChannel: string | null) => {
      setChannel(nextChannel);
      syncChannelParam(nextChannel);
    },
    [syncChannelParam],
  );

  // Sync channel from URL if provided
  useEffect(() => {
    const urlChannel = searchParams.get("channel");
    if (urlChannel !== lastUrlChannelRef.current) {
      lastUrlChannelRef.current = urlChannel;
      setChannel(urlChannel);
    }
  }, [searchParams]);

  // Load media source preference from localStorage and stay in sync with other tabs/pages.
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

  // Load available channels and media list once
  useEffect(() => {
    let cancelled = false;
    setFiles([]);
    setLoading(true);
    setMessage(null);
    setError(null);

    const load = async () => {
      try {
        const channelsRes = await fetch(
          `/api/channels?source=${encodeURIComponent(mediaSource)}`,
        );
        const channelsJson = await channelsRes.json();
        // Normalize channels to ChannelInfo objects (handles legacy string[] responses)
        const channelList: ChannelInfo[] = Array.isArray(channelsJson.channels)
          ? channelsJson.channels.map((ch: unknown) => {
              if (typeof ch === "string") return { id: ch };
              if (ch && typeof ch === "object" && typeof (ch as ChannelInfo).id === "string") {
                return ch as ChannelInfo;
              }
              return null;
            }).filter(Boolean) as ChannelInfo[]
          : [];

        let filesJson: { items?: MediaFile[] } = {};
        if (mediaSource === "remote") {
          try {
            const manifestRes = await fetch(
              `/api/media-index?base=${encodeURIComponent(REMOTE_MEDIA_BASE)}&t=${Date.now()}`,
              { cache: "no-store" },
            );
            if (!manifestRes.ok) {
              const text = await manifestRes.text();
              throw new Error(text);
            }
            filesJson = await manifestRes.json();
          } catch (err) {
            console.warn("Remote manifest fetch failed", err);
            throw new Error("Failed to load remote media index");
          }
        } else {
          const filesRes = await fetch(
            `/api/media-files?t=${Date.now()}`,
            { cache: "no-store" },
          );
          filesJson = await filesRes.json();
        }

        if (!cancelled) {
          setFiles(filesJson.items || []);
          setChannels(channelList);
          // Auto-select first channel if none selected or current channel no longer exists
          const channelIds = channelList.map(c => c.id);
          if (channelList.length > 0) {
            if (!channel || !channelIds.includes(channel)) {
              handleChannelChange(channelList[0].id);
            }
          } else {
            handleChannelChange(null);
          }
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load schedule or files");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [mediaSource]);

  // Reload schedule when channel changes
  useEffect(() => {
    // Don't load if no channel is selected
    if (!channel) {
      setSlots([]);
      lastSavedSlotsRef.current = "[]";
      lastSavedChannelRef.current = null;
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setError(null);
    
    // Clear any pending auto-save for the previous channel
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    setAutoSaveStatus("idle");

    const loadSchedule = async () => {
      try {
        const res = await fetch(
          `/api/schedule?channel=${encodeURIComponent(channel)}&source=${encodeURIComponent(mediaSource)}`,
        );
        const schedJson = await res.json();
        if (!cancelled) {
          const savedSlots = schedJson?.schedule?.slots ?? [];
          const normalizedSlots = Array.isArray(savedSlots) ? savedSlots : [];
          setSlots(normalizedSlots);
          // CRITICAL: Update lastSavedSlotsRef and channel immediately to prevent
          // auto-save from firing when switching channels
          lastSavedSlotsRef.current = JSON.stringify(normalizedSlots);
          lastSavedChannelRef.current = channel;
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load schedule");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSchedule();
    return () => {
      cancelled = true;
    };
  }, [channel, mediaSource]);

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) =>
        a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" }),
      ),
    [files],
  );

  // Only supported files for schedule dropdowns
  const supportedFiles = useMemo(
    () => sortedFiles.filter((file) => isBrowserSupported(file)),
    [sortedFiles],
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

  // Fill modal filtered files
  const filteredFillModalFiles = useMemo(() => {
    const query = fillMediaFilter.trim().toLowerCase();
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];
    return sortedFiles.filter((file) => {
      const browserSupported = isBrowserSupported(file);
      if (fillSupportedFilter === "supported" && !browserSupported) return false;
      if (fillSupportedFilter === "unsupported" && browserSupported) return false;
      if (!terms.length) return true;
      const haystack = `${file.relPath} ${file.title || ""}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [fillMediaFilter, sortedFiles, fillSupportedFilter]);

  const fillModalPoolSize = useMemo(() => {
    if (fillSupportedFilter === "supported") return supportedFiles.length;
    if (fillSupportedFilter === "unsupported") return Math.max(0, sortedFiles.length - supportedFiles.length);
    return sortedFiles.length;
  }, [fillSupportedFilter, supportedFiles.length, sortedFiles.length]);

  const fileByRel = useMemo(() => {
    const map = new Map<string, MediaFile>();
    for (const f of sortedFiles) map.set(f.relPath, f);
    return map;
  }, [sortedFiles]);

  // Detect schedule conflicts (overlapping slots)
  const scheduleConflicts = useMemo(() => {
    return detectScheduleConflicts(slots);
  }, [slots]);

  // Set of slot indices that have conflicts (for highlighting)
  const conflictingSlotIndices = useMemo(() => {
    const indices = new Set<number>();
    for (const conflict of scheduleConflicts) {
      indices.add(conflict.slotAIndex);
      indices.add(conflict.slotBIndex);
    }
    return indices;
  }, [scheduleConflicts]);

  // Calculate total duration of selected files for fill modal
  const fillTotalDuration = useMemo(() => {
    return fillSelectedFiles.reduce((total, relPath) => {
      const file = fileByRel.get(relPath);
      return total + (file?.durationSeconds || 0);
    }, 0);
  }, [fillSelectedFiles, fileByRel]);

  // Calculate how much of 24h will be filled after looping
  const fillLoopedInfo = useMemo(() => {
    if (fillTotalDuration <= 0) return { filledSeconds: 0, itemCount: 0, leftoverSeconds: 0 };
    
    const validFiles = fillSelectedFiles
      .map((relPath) => fileByRel.get(relPath))
      .filter((f) => f && f.durationSeconds > 0) as MediaFile[];
    
    if (validFiles.length === 0) return { filledSeconds: 0, itemCount: 0, leftoverSeconds: 0 };

    let currentSeconds = 0;
    let itemCount = 0;
    let fileIndex = 0;

    // Fill until the next item wouldn't fit before midnight
    while (itemCount < 1000) {
      const file = validFiles[fileIndex % validFiles.length];
      // Stop if this item would extend past midnight
      if (currentSeconds + file.durationSeconds > 86400) break;
      
      currentSeconds += file.durationSeconds;
      itemCount++;
      fileIndex++;
    }

    const leftoverSeconds = 86400 - currentSeconds;

    return {
      filledSeconds: currentSeconds,
      itemCount,
      leftoverSeconds,
    };
  }, [fillSelectedFiles, fillTotalDuration, fileByRel]);

  // Get selected files in order with their details
  const fillSelectedFilesOrdered = useMemo(() => {
    return fillSelectedFiles
      .map((relPath) => fileByRel.get(relPath))
      .filter(Boolean) as MediaFile[];
  }, [fillSelectedFiles, fileByRel]);

  const toggleFillFileSelection = useCallback((relPath: string) => {
    setFillSelectedFiles((prev) => {
      if (prev.includes(relPath)) {
        return prev.filter((p) => p !== relPath);
      }
      return [...prev, relPath];
    });
  }, []);

  const openFillModal = useCallback(() => {
    setFillSelectedFiles([]);
    setFillMediaFilter("");
    setFillSupportedFilter("supported");
    setShowFillModal(true);
  }, []);

  const executeFillSchedule = useCallback(async () => {
    if (!channel || fillSelectedFiles.length === 0) return;

    // Get files with valid durations
    const validFiles = fillSelectedFiles
      .map((relPath) => {
        const file = fileByRel.get(relPath);
        return file && file.durationSeconds > 0 ? file : null;
      })
      .filter(Boolean) as MediaFile[];

    if (validFiles.length === 0) return;

    // Build slots starting at 00:00:00, looping until next item wouldn't fit
    const newSlots: ScheduleSlot[] = [];
    let currentSeconds = 0;
    let fileIndex = 0;

    while (newSlots.length < 1000) {
      const file = validFiles[fileIndex % validFiles.length];
      const duration = file.durationSeconds;

      // Stop if this item would extend past midnight
      if (currentSeconds + duration > 86400) break;

      const startTime = secondsToTime(currentSeconds);
      const endTime = secondsToTime(currentSeconds + duration);

      newSlots.push({
        start: startTime,
        end: endTime,
        file: file.relPath,
      });

      currentSeconds += duration;
      fileIndex++;
    }

    // Replace the schedule with the new slots
    setSlots(newSlots);
    setShowFillModal(false);
  }, [channel, fillSelectedFiles, fileByRel]);

  const addSlot = () => {
    const defaultFile = supportedFiles[0]?.relPath || "";
    const nextStart =
      slots.length > 0
        ? incrementTime(slots[slots.length - 1].start, 60)
        : "00:00:00";
    setModalFile(defaultFile);
    setModalStart(nextStart);
    setModalEnd(computeEndTime(nextStart, defaultFile, sortedFiles));
    setShowSlotModal(true);
  };

  useEffect(() => {
    setCopiedCommand(false);
  }, [selectedFile]);

  const setModalStartWithSuggestedTime = useCallback(
    (startValue: string) => {
      setModalStart(startValue);
      const suggestedEnd = computeEndTime(startValue, modalFile, sortedFiles);
      lastSuggestedEndRef.current = suggestedEnd;
      setModalEnd(suggestedEnd);
    },
    [modalFile, sortedFiles],
  );

  const updateSlot = (index: number, slot: ScheduleSlot) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? slot : s)));
  };

  const clearSchedule = async () => {
    if (!channel) return;
    const confirmed = window.confirm(
      `Clear schedule for "${channel}"? This removes all items for this channel.`,
    );
    if (!confirmed) return;

    const previousSaved = lastSavedSlotsRef.current;
    const previousChannel = lastSavedChannelRef.current;
    lastSavedSlotsRef.current = JSON.stringify([]);
    lastSavedChannelRef.current = channel;

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
      lastSavedChannelRef.current = previousChannel;
      setError("Failed to clear schedule");
      setAutoSaveStatus("idle");
    }
  };

  // Core save function - always saves to local, then pushes to remote if needed
  const doSave = useCallback(async (slotsToPersist: ScheduleSlot[]) => {
    if (!channel) return false;

    const normalized = [...slotsToPersist].sort(
      (a, b) => timeToSeconds(a.start) - timeToSeconds(b.start),
    );

    const body: DailySchedule = { slots: normalized };
    try {
      validateDailySchedule(body);
    } catch {
      return false;
    }

    try {
      // Always save to local first
      const res = await fetch(
        `/api/schedule?channel=${encodeURIComponent(channel)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) return false;
      lastSavedSlotsRef.current = JSON.stringify(normalized);
      lastSavedChannelRef.current = channel;

      // If remote source is active, push schedule to remote
      if (mediaSource === "remote") {
        try {
          await fetch("/api/schedule/push", { method: "POST" });
        } catch {
          // Ignore push errors - local save succeeded
        }
      }

      return true;
    } catch {
      return false;
    }
  }, [channel, mediaSource]);

  // Auto-save effect with debouncing
  useEffect(() => {
    if (!channel) return;
    if (loading) return;

    const currentSlots = JSON.stringify(slots);
    
    // Skip if no changes since last save for THIS channel
    // This prevents cross-channel data leaks when switching channels
    if (
      currentSlots === lastSavedSlotsRef.current &&
      channel === lastSavedChannelRef.current
    ) {
      setAutoSaveStatus("idle");
      return;
    }
    
    // If channel changed but refs weren't updated yet, skip auto-save
    // (the loadSchedule effect will update the refs)
    if (channel !== lastSavedChannelRef.current) {
      return;
    }

    // Mark as pending
    setAutoSaveStatus("pending");

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Debounce save by 800ms
    autoSaveTimeoutRef.current = setTimeout(() => {
      setAutoSaveStatus("saving");
      void doSave(slots).then((success) => {
        if (success) {
          setAutoSaveStatus("saved");
          // Reset to idle after showing "saved" briefly
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
  }, [slots, channel, mediaSource, loading, doSave]);

  // Note: lastSavedSlotsRef is now updated in the loadSchedule effect
  // to prevent race conditions with the auto-save effect

  const removeSlot = (index: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const scheduleNext = (slot: ScheduleSlot) => {
    const nextStart = incrementTime(slot.end, 1);
    // Use the previous file if it's supported, otherwise default to first supported file
    const file = supportedFiles.find((f) => f.relPath === slot.file)
      ? slot.file
      : supportedFiles[0]?.relPath || "";
    setModalFile(file);
    setModalStart(nextStart);
    setModalEnd(computeEndTime(nextStart, file, sortedFiles));
    setShowSlotModal(true);
  };

  // Keep end time in sync when file, start time, or durations change.
  // Only overwrite if the current end matches the previous suggestion or is invalid.
  useEffect(() => {
    const suggested = computeEndTime(modalStart, modalFile, sortedFiles);
    const shouldUpdate =
      !isValidTime(modalEnd) || modalEnd === lastSuggestedEndRef.current;
    if (shouldUpdate && suggested !== modalEnd) {
      lastSuggestedEndRef.current = suggested;
      setModalEnd(suggested);
    } else {
      lastSuggestedEndRef.current = suggested;
    }
  }, [modalStart, modalFile, sortedFiles, modalEnd]);

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">
            Schedule Admin
          </p>
          <p className="text-sm text-neutral-400">
            Single-day (24h, UTC) schedule per channel. Changes auto-save{mediaSource === "remote" ? " and push to remote" : " to local JSON"}.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Add or edit slots — changes save automatically{mediaSource === "remote" ? " and sync to CDN via FTP" : ""}.
          </p>
        </div>
      </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <label className="text-neutral-300">Channel</label>
            <select
              value={channel ?? ""}
              onChange={(e) => handleChannelChange(e.target.value || null)}
              disabled={loadingChannels || channels.length === 0}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-neutral-100"
            >
              {channels.length === 0 && (
                <option value="">No channels</option>
              )}
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}{c.shortName ? ` - ${c.shortName}` : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={addSlot}
            className="rounded-md border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-neutral-50 transition hover:border-white/30 hover:bg-white/15"
            disabled={loading || autoSaveStatus === "saving"}
          >
            + Add schedule item
          </button>
          <button
            onClick={openFillModal}
            className="rounded-md border border-indigo-400/60 bg-indigo-500/20 px-3 py-1 text-sm font-semibold text-indigo-50 transition hover:border-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50"
            disabled={loading || autoSaveStatus === "saving" || !channel || sortedFiles.length === 0}
            title="Select multiple files to fill a 24-hour schedule"
          >
            Fill 24
          </button>
          <button
            onClick={() => void clearSchedule()}
            className="rounded-md border border-red-400/60 bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-50 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
            disabled={
              loading ||
              autoSaveStatus === "saving" ||
              !channel ||
              slots.length === 0
            }
            title="Remove all schedule items for this channel"
          >
            Clear schedule
          </button>
          <span
            className={`text-xs px-2 py-1 rounded-full transition-opacity ${
              autoSaveStatus === "saving"
                ? "bg-blue-500/20 text-blue-200"
                : autoSaveStatus === "saved"
                  ? "bg-emerald-500/20 text-emerald-200"
                  : autoSaveStatus === "pending"
                    ? "bg-amber-500/20 text-amber-200"
                    : "opacity-0"
            }`}
          >
            {autoSaveStatus === "saving"
              ? mediaSource === "remote" ? "Saving & pushing…" : "Saving…"
              : autoSaveStatus === "saved"
                ? mediaSource === "remote" ? "Saved & pushed" : "Saved"
                : autoSaveStatus === "pending"
                  ? "Unsaved changes"
                  : ""}
          </span>
          {mediaSource === "remote" && (
            <span className="text-xs text-blue-300">Changes auto-sync to remote</span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-neutral-300">Loading…</p>
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
                          <span className="font-mono">
                            {conflict.slotA.start}–{conflict.slotA.end}
                          </span>
                          {" "}overlaps with{" "}
                          <span className="font-mono">
                            {conflict.slotB.start}–{conflict.slotB.end}
                          </span>
                          <span className="text-amber-300/70 ml-2">
                            ({formatDuration(conflict.overlapSeconds)} overlap)
                          </span>
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
                        <th className="px-3 py-2 text-right font-semibold w-28">
                          Duration
                        </th>
                        <th className="px-3 py-2 text-right font-semibold w-20">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {slots
                        .map((slot, idx) => ({ slot, idx }))
                        .sort(
                          (a, b) =>
                            timeToSeconds(a.slot.start) - timeToSeconds(b.slot.start),
                        )
                        .map(({ slot, idx }) => {
                          const slotFileMeta = fileByRel.get(slot.file);
                          const slotIsSupported = slotFileMeta ? isBrowserSupported(slotFileMeta) : false;
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
                                <div className="flex items-center gap-2">
                                  <input
                                    type="time"
                                    step="1"
                                    className="w-24 rounded-md bg-neutral-900 border border-white/10 px-2 py-1 text-sm"
                                    value={slot.start}
                                    onChange={(e) =>
                                      updateSlot(idx, { ...slot, start: e.target.value })
                                    }
                                  />
                                  {isMidnightCrossing && (
                                    <span className="text-[10px] text-indigo-300" title="Crosses midnight">🌙</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="time"
                                    step="1"
                                    className="w-24 rounded-md bg-neutral-900 border border-white/10 px-2 py-1 text-sm"
                                    value={slot.end}
                                    onChange={(e) =>
                                      updateSlot(idx, { ...slot, end: e.target.value })
                                    }
                                  />
                                  {isMidnightCrossing && (
                                    <span className="text-[10px] text-indigo-300" title="Next day">+1d</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  className={`w-full rounded-md bg-neutral-900 border px-2 py-1 text-sm ${
                                    slotIsSupported ? "border-white/10" : "border-amber-500/50"
                                  }`}
                                  value={slot.file}
                                  onChange={(e) =>
                                    updateSlot(idx, { ...slot, file: e.target.value })
                                  }
                                >
                                  {/* Show current file if it's unsupported (so it doesn't disappear from dropdown) */}
                                  {slot.file && !supportedFiles.some(f => f.relPath === slot.file) && fileByRel.get(slot.file) && (
                                    <option key={slot.file} value={slot.file} className="text-amber-300">
                                      ⚠️ {slot.file} ({formatDuration(fileByRel.get(slot.file)?.durationSeconds || 0)}) - UNSUPPORTED
                                    </option>
                                  )}
                                  {supportedFiles.map((file) => (
                                    <option key={file.relPath} value={file.relPath}>
                                      {file.relPath} ({formatDuration(file.durationSeconds)})
                                    </option>
                                  ))}
                                  {supportedFiles.length === 0 && (
                                    <option value="">No supported files in library</option>
                                  )}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-right text-neutral-300">
                                <div className="flex flex-col items-end text-xs">
                                  <span title="File duration">{duration ? formatDuration(duration) : "—"}</span>
                                  {slotWindow !== duration && (
                                    <span className="text-neutral-500" title="Slot window">
                                      ({formatDuration(slotWindow)} window)
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => scheduleNext(slot)}
                                    className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/40 hover:bg-white/15"
                                  >
                                    Schedule next
                                  </button>
                                  <button
                                    onClick={() => removeSlot(idx)}
                                    className="rounded-md border border-red-400/50 bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-100 transition hover:border-red-300 hover:bg-red-500/30"
                                  >
                                    Remove
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
        {error && <p className="text-sm text-amber-300">{error}</p>}
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
              <h4 className="text-sm font-semibold text-neutral-100">
                Add schedule item
              </h4>
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
                        onChange={(e) =>
                          setSupportedFilter(e.target.value as "all" | "supported" | "unsupported")
                        }
                        className="rounded-md border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                      >
                        <option value="supported">Supported</option>
                        <option value="unsupported">Unsupported</option>
                        <option value="all">All</option>
                      </select>
                    </div>
                    <span className="text-neutral-500">
                      {filteredModalFiles.length}/{modalPoolSize}
                    </span>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-white/10 bg-neutral-950/80">
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-white/5 text-neutral-200">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">File</th>
                          <th className="px-3 py-2 text-right font-semibold w-24">Duration</th>
                          <th className="px-3 py-2 text-right font-semibold w-28">Support</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredModalFiles.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3}
                              className="px-3 py-3 text-center text-neutral-400"
                            >
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
                              ? file.supportedViaCompanion
                                ? "Companion"
                                : "Direct"
                              : hasUnsupportedAudio(file)
                                ? "Unsupported (audio)"
                                : "Unsupported";
                            const supportClass = browserSupported
                              ? file.supportedViaCompanion
                                ? "bg-blue-500/20 text-blue-100"
                                : "bg-emerald-500/20 text-emerald-100"
                              : "bg-amber-500/20 text-amber-100";
                            return (
                              <tr
                                key={file.relPath}
                                className={`cursor-pointer transition ${
                                  selected ? "bg-white/10" : "hover:bg-white/5"
                                }`}
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
                                      <p className="font-mono text-xs break-all text-neutral-100">
                                        {file.relPath}
                                      </p>
                                      {file.title && file.title !== file.relPath && (
                                        <p className="text-[11px] text-neutral-400">
                                          {file.title}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right text-neutral-300">
                                  {formatDuration(file.durationSeconds)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <span
                                    className={`rounded-full px-2 py-1 text-[11px] ${supportClass}`}
                                  >
                                    {supportLabel}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
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
                    onChange={(e) => {
                      setModalStartWithSuggestedTime(e.target.value);
                    }}
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
              {supportedFiles.length === 0 && sortedFiles.length > 0 && (
                <p className="text-xs text-amber-300">
                  No browser-supported media files. Convert unsupported files to MP4/AAC first.
                </p>
              )}
              {sortedFiles.length === 0 && (
                <p className="text-xs text-amber-300">
                  Add media to your library before creating a schedule item.
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
                onClick={() => {
                  void (async () => {
                    if (
                      !modalFile ||
                      !isValidTime(modalStart) ||
                      !isValidTime(modalEnd) ||
                      timeToSeconds(modalEnd) === timeToSeconds(modalStart) // Only reject zero-duration
                    )
                      return;
                    const newSlot: ScheduleSlot = {
                      start: modalStart,
                      end: modalEnd,
                      file: modalFile,
                    };
                    const nextSlots = [...slots, newSlot].sort(
                      (a, b) => timeToSeconds(a.start) - timeToSeconds(b.start),
                    );
                    setSlots(nextSlots);
                    setShowSlotModal(false);
                  })();
                }}
                disabled={!modalFile || !isValidTime(modalStart) || !isValidTime(modalEnd) || timeToSeconds(modalEnd) === timeToSeconds(modalStart)}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                Add schedule item
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setSelectedFile(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-white/15 bg-neutral-900 p-5 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-neutral-100">Media details</h4>
              <button
                onClick={() => setSelectedFile(null)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs text-neutral-100 hover:bg-white/20"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-2 text-sm text-neutral-100">
              <div>
                <p className="text-xs uppercase text-neutral-400">File</p>
                <p className="font-mono break-all">{selectedFile.relPath}</p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="rounded-full bg-white/10 px-3 py-1 text-neutral-100">
                  Format: {selectedFile.format || "—"}
                </span>
                {(() => {
                  const selectedSupported = isBrowserSupported(selectedFile);
                  const supportLabel = selectedSupported
                    ? selectedFile.supportedViaCompanion
                      ? "Supported (companion)"
                      : "Supported"
                    : hasUnsupportedAudio(selectedFile)
                      ? "Unsupported (audio)"
                      : "Not supported";
                  return (
                    <span
                      className={`rounded-full px-3 py-1 font-semibold ${
                        selectedSupported
                          ? "bg-emerald-500/20 text-emerald-100"
                          : "bg-amber-500/20 text-amber-100"
                      }`}
                    >
                      {supportLabel}
                    </span>
                  );
                })()}
                <span className="rounded-full bg-white/10 px-3 py-1 text-neutral-100">
                  Duration: {formatDuration(selectedFile.durationSeconds)}
                </span>
              </div>

              {isBrowserSupported(selectedFile) ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-neutral-300">Quick preview (muted):</p>
                  <video
                    key={selectedFile.relPath}
                    controls
                    muted
                    preload="metadata"
                    className="w-full rounded-lg border border-white/10 bg-black"
                    src={`/api/media?file=${encodeURIComponent(selectedFile.relPath)}`}
                  />
                  {selectedFile.supportedViaCompanion && (
                    <p className="text-[11px] text-amber-200">
                      Uses companion browser-friendly file (same basename).
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-amber-300">
                  This format may not play in the browser. Convert before previewing.
                </p>
              )}

              {shouldShowConvert(selectedFile) && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-neutral-300">
                    {getConversionDescription(selectedFile)}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyConvertCommand(selectedFile, setCopiedCommand)}
                      className="rounded-md border border-white/20 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30"
                    >
                      {copiedCommand ? "Copied!" : "Copy conversion command"}
                    </button>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      needsFullReencode(selectedFile)
                        ? "bg-amber-500/20 text-amber-200"
                        : "bg-blue-500/20 text-blue-200"
                    }`}>
                      {needsFullReencode(selectedFile) ? "Full re-encode" : "Remux + audio"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showFillModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowFillModal(false)}
        >
          <div
            className="w-full max-w-4xl rounded-xl border border-white/15 bg-neutral-900 p-5 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-neutral-100">
                  Fill 24-hour schedule
                </h4>
                <p className="text-xs text-neutral-400 mt-1">
                  Select files in order. They'll <span className="text-indigo-300">loop</span> to fill 24 hours starting at midnight.
                </p>
              </div>
              <button
                onClick={() => setShowFillModal(false)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs text-neutral-100 hover:bg-white/20"
              >
                Close
              </button>
            </div>

            <div className="mt-4 flex gap-4">
              {/* Left side: Media picker */}
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm text-neutral-300">Available Media</label>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                    <button
                      onClick={() => {
                        const filesToAdd = filteredFillModalFiles
                          .map((f) => f.relPath)
                          .filter((p) => !fillSelectedFiles.includes(p));
                        if (filesToAdd.length > 0) {
                          setFillSelectedFiles((prev) => [...prev, ...filesToAdd]);
                        }
                      }}
                      disabled={filteredFillModalFiles.length === 0}
                      className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-200 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      Select all
                    </button>
                    <input
                      type="text"
                      placeholder="Filter media…"
                      value={fillMediaFilter}
                      onChange={(e) => setFillMediaFilter(e.target.value)}
                      className="w-48 rounded-md bg-neutral-900 border border-white/10 px-2 py-1 text-sm focus:border-white/30 focus:outline-none"
                    />
                    <select
                      value={fillSupportedFilter}
                      onChange={(e) =>
                        setFillSupportedFilter(e.target.value as "all" | "supported" | "unsupported")
                      }
                      className="rounded-md border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                    >
                      <option value="supported">Supported</option>
                      <option value="unsupported">Unsupported</option>
                      <option value="all">All</option>
                    </select>
                    <span className="text-neutral-500">
                      {filteredFillModalFiles.length}/{fillModalPoolSize}
                    </span>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-white/10 bg-neutral-950/80">
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-white/5 text-neutral-200 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold w-10"></th>
                          <th className="px-3 py-2 text-left font-semibold">File</th>
                          <th className="px-3 py-2 text-right font-semibold w-20">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredFillModalFiles.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3}
                              className="px-3 py-3 text-center text-neutral-400"
                            >
                              {fillModalPoolSize === 0
                                ? "No media files available"
                                : "No matches — adjust filter"}
                            </td>
                          </tr>
                        ) : (
                          filteredFillModalFiles.map((file) => {
                            const selected = fillSelectedFiles.includes(file.relPath);
                            const selectionIndex = fillSelectedFiles.indexOf(file.relPath);
                            return (
                              <tr
                                key={file.relPath}
                                className={`cursor-pointer transition ${
                                  selected ? "bg-indigo-500/20" : "hover:bg-white/5"
                                }`}
                                onClick={() => toggleFillFileSelection(file.relPath)}
                              >
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-center">
                                    {selected ? (
                                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                                        {selectionIndex + 1}
                                      </span>
                                    ) : (
                                      <span className="h-5 w-5 rounded border border-white/20 bg-white/5" />
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <p className="font-mono text-xs break-all text-neutral-100">
                                    {file.relPath}
                                  </p>
                                  {file.title && file.title !== file.relPath && (
                                    <p className="text-[11px] text-neutral-400">
                                      {file.title}
                                    </p>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right text-neutral-300">
                                  {formatDuration(file.durationSeconds)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right side: Selected files preview */}
              <div className="w-72 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-neutral-300">Selection Order</label>
                  {fillSelectedFiles.length > 0 && (
                    <button
                      onClick={() => setFillSelectedFiles([])}
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                <div className="rounded-lg border border-white/10 bg-neutral-950/80 p-3">
                  {fillSelectedFiles.length === 0 ? (
                    <p className="text-xs text-neutral-500 text-center py-4">
                      Click files to add them to your schedule
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-auto">
                      {fillSelectedFilesOrdered.map((file, idx) => {
                        // Calculate start time for this file
                        const offsetSeconds = fillSelectedFilesOrdered
                          .slice(0, idx)
                          .reduce((acc, f) => acc + (f.durationSeconds || 0), 0);
                        const startTime = secondsToTime(offsetSeconds % 86400);
                        const startsAfter24 = offsetSeconds >= 86400;
                        
                        return (
                          <div
                            key={file.relPath}
                            className={`flex items-start gap-2 rounded-md p-2 text-xs ${
                              startsAfter24 ? "bg-amber-500/10 opacity-60" : "bg-white/5"
                            }`}
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-[11px] text-neutral-100 truncate">
                                {file.relPath}
                              </p>
                              <p className="text-[10px] text-neutral-400">
                                {startsAfter24 ? (
                                  <span className="text-amber-300">Exceeds 24h</span>
                                ) : (
                                  <>
                                    Starts: {startTime} • {formatDuration(file.durationSeconds)}
                                  </>
                                )}
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFillFileSelection(file.relPath);
                              }}
                              className="text-neutral-500 hover:text-red-300"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Summary */}
                <div className="rounded-lg border border-white/10 bg-neutral-950/80 p-3 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Files selected</span>
                    <span className="text-neutral-100">{fillSelectedFiles.length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Playlist duration</span>
                    <span className="text-neutral-100">{formatDuration(fillTotalDuration)}</span>
                  </div>
                  {fillTotalDuration > 0 && (
                    <>
                      <div className="border-t border-white/10 pt-2 mt-2">
                        <p className="text-[10px] text-neutral-400 mb-1">After looping to fill 24h:</p>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-neutral-400">Total slots</span>
                        <span className="text-neutral-100">{fillLoopedInfo.itemCount}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-neutral-400">Scheduled time</span>
                        <span className="text-neutral-100">{formatDuration(fillLoopedInfo.filledSeconds)}</span>
                      </div>
                      {fillLoopedInfo.leftoverSeconds > 0 && (
                        <p className="text-[10px] text-neutral-400 mt-1">
                          {formatDuration(fillLoopedInfo.leftoverSeconds)} of empty time before loop resets
                        </p>
                      )}
                      {fillLoopedInfo.leftoverSeconds === 0 && (
                        <p className="text-[10px] text-emerald-300 mt-1">
                          ✓ Fills exactly 24 hours
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-neutral-500">
                {slots.length > 0 && (
                  <span className="text-amber-300">
                    ⚠️ This will replace the current {slots.length} scheduled item{slots.length !== 1 ? "s" : ""}.
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowFillModal(false)}
                  className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void executeFillSchedule()}
                  disabled={fillSelectedFiles.length === 0}
                  className="rounded-md border border-indigo-300/50 bg-indigo-500/20 px-4 py-2 text-xs font-semibold text-indigo-50 transition hover:border-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
                >
                  Fill schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function timeToSeconds(value: string): number {
  const parts = value.split(":").map((n) => Number(n));
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return ((h * 60 + m) * 60 + s) % 86400;
}

/**
 * Detect overlapping slots in a schedule.
 * Handles midnight-crossing slots correctly.
 */
function detectScheduleConflicts(slots: ScheduleSlot[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  if (slots.length < 2) return conflicts;

  // Sort slots by start time for consistent ordering
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

/**
 * Calculate overlap in seconds between two slots.
 * Returns 0 if no overlap.
 */
function calculateOverlap(slotA: ScheduleSlot, slotB: ScheduleSlot): number {
  const aStart = timeToSeconds(slotA.start);
  const aEnd = timeToSeconds(slotA.end);
  const bStart = timeToSeconds(slotB.start);
  const bEnd = timeToSeconds(slotB.end);

  const aCrosses = aEnd <= aStart; // crosses midnight
  const bCrosses = bEnd <= bStart; // crosses midnight

  // Convert to ranges on a 48-hour timeline for easier comparison
  // This handles midnight crossing by extending into "next day" (86400+)
  const aRanges = aCrosses
    ? [[aStart, 86400], [0, aEnd]] // Split into two ranges
    : [[aStart, aEnd]];
  
  const bRanges = bCrosses
    ? [[bStart, 86400], [0, bEnd]]
    : [[bStart, bEnd]];

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

/**
 * Calculate slot duration accounting for midnight crossover.
 * If end < start, the slot crosses midnight (e.g., 23:00 -> 01:00 = 2 hours).
 */
function slotDurationSeconds(startTime: string, endTime: string): number {
  const startSec = timeToSeconds(startTime);
  const endSec = timeToSeconds(endTime);
  if (endSec > startSec) {
    return endSec - startSec;
  }
  // Crosses midnight
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
  "ac3",
  "eac3",
  "dts",
  "truehd",
  "dts-hd",
  "dtshd",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "flac",
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

function shouldShowConvert(file: MediaFile): boolean {
  // Don't show if there's a companion browser-friendly file
  if (file.supportedViaCompanion) return false;
  
  // Show conversion option if file is marked as not supported
  if (!file.supported) return true;
  
  // For MKV files that ARE supported, still offer conversion option
  // since remuxing to MP4 improves compatibility (Safari, older browsers)
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  if (ext === "mkv") return true;
  
  return false;
}

function needsFullReencode(file: MediaFile): boolean {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const filename = file.relPath.toLowerCase();
  
  // Legacy formats that always need full re-encode
  const fullReencodeExtensions = ["avi", "wmv", "asf", "flv", "mpeg", "mpg", "vob", "ogv", "ogg", "3gp", "3g2"];
  
  // Check if file has H.264 indicator (these play in browsers)
  const isH264 = filename.includes("x264") || 
                 filename.includes("h264") || 
                 filename.includes("h.264") ||
                 filename.includes("avc");
  
  // AVI with H.264 only needs remux, not full re-encode
  if (ext === "avi" && isH264) return false;
  
  // Other legacy extensions need full re-encode
  if (fullReencodeExtensions.includes(ext)) return true;
  
  // x265/HEVC content needs re-encoding for browser compatibility
  const isHevc = file.format?.toLowerCase()?.includes("hevc") || 
                 file.format?.toLowerCase()?.includes("x265") ||
                 filename.includes("x265") ||
                 filename.includes("hevc") ||
                 filename.includes("h265") ||
                 filename.includes("h.265");
  
  return isHevc;
}

function getConversionDescription(file: MediaFile): string {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const filename = file.relPath.toLowerCase();
  
  // Check if file indicates H.264 codec
  const isH264 = filename.includes("x264") || 
                 filename.includes("h264") || 
                 filename.includes("h.264") ||
                 filename.includes("avc");
  
  switch (ext) {
    case "avi":
      if (isH264) {
        return "AVI with H.264 - will remux to MP4 with AAC audio.";
      }
      return "AVI files (XviD/DivX) need full re-encoding to H.264 for browser playback.";
    case "wmv":
    case "asf":
      return "Windows Media files need full re-encoding to H.264.";
    case "flv":
      return "Flash Video needs full re-encoding to H.264.";
    case "mov":
      if (needsFullReencode(file)) {
        return "QuickTime with HEVC needs re-encoding to H.264.";
      }
      return "QuickTime file - will remux with AAC audio.";
    case "mkv":
      if (needsFullReencode(file)) {
        return "MKV with HEVC/x265 needs re-encoding to H.264 for browser support.";
      }
      return "MKV will be remuxed to MP4 with AAC audio (video stream copied). Most browsers support this natively.";
    case "mpeg":
    case "mpg":
    case "vob":
      return "MPEG/DVD format needs full re-encoding to H.264.";
    case "webm":
      return "WebM is browser-supported. Converting to MP4 for broader compatibility.";
    case "ogv":
    case "ogg":
      return "Ogg/Theora needs full re-encoding to H.264.";
    case "3gp":
    case "3g2":
      return "Mobile format needs re-encoding to H.264.";
    case "mp4":
    case "m4v":
      if (needsFullReencode(file)) {
        return "MP4 with HEVC/x265 needs re-encoding to H.264 for browser support.";
      }
      return "MP4 will be remuxed with AAC audio (if audio isn't already AAC).";
    default:
      return "Will attempt to remux to MP4 with AAC audio. If playback fails, try full re-encode.";
  }
}

function copyConvertCommand(
  file: MediaFile,
  setCopied: (value: boolean) => void,
) {
  const cmd = buildConvertCommand(file);
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard
      .writeText(cmd)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  } else {
    setCopied(false);
    window.prompt("Copy this command", cmd);
  }
}

function buildConvertCommand(file: MediaFile): string {
  const escapedIn = escapeDoubleQuotes(file.relPath);
  const base = file.relPath.replace(/\.[^/.]+$/, "");
  const escapedOut = escapeDoubleQuotes(`${base}.mp4`);
  const inputPath = `"media/${escapedIn}"`;
  const outputPath = `"media/${escapedOut}"`;

  // Get file extension (lowercase)
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  
  // Determine the appropriate ffmpeg command based on file type
  switch (ext) {
    case "avi":
      // Check if AVI has H.264 (rare but possible) - can remux
      if (file.relPath.toLowerCase().includes("x264") || 
          file.relPath.toLowerCase().includes("h264") ||
          file.relPath.toLowerCase().includes("h.264")) {
        return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      // AVI files typically use legacy codecs (XviD, DivX) that need full re-encoding
      // Use H.264 with CRF 18 for high quality, medium preset for good speed/quality balance
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "wmv":
    case "asf":
      // Windows Media files need full re-encoding
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "flv":
      // Flash Video - older format, needs re-encoding
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mov":
      // QuickTime - may use ProRes or other codecs, try copy first with audio re-encode
      // If this fails, user can try the avi command manually
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mkv":
      // MKV containers - check if format indicates x265/HEVC (less browser support)
      // For HEVC content, re-encode to H.264; otherwise just copy video and re-encode audio
      if (file.format?.toLowerCase()?.includes("hevc") || 
          file.format?.toLowerCase()?.includes("x265") ||
          file.relPath.toLowerCase().includes("x265") ||
          file.relPath.toLowerCase().includes("hevc")) {
        return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      // For x264/h264 MKV files, just remux to MP4 with AAC audio
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mpeg":
    case "mpg":
    case "vob":
      // DVD/MPEG formats - need re-encoding
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "ts":
    case "m2ts":
    case "mts":
      // Transport stream formats - often H.264 but may have compatibility issues
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "webm":
      // WebM with VP8/VP9 - re-encode to H.264 for broader compatibility
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "ogv":
    case "ogg":
      // Ogg/Theora - needs re-encoding
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "3gp":
    case "3g2":
      // Mobile formats - may need re-encoding depending on codec
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mp4":
    case "m4v":
      // MP4 container - likely just needs audio re-encoding to AAC
      // Check for x265/HEVC which has limited browser support
      if (file.format?.toLowerCase()?.includes("hevc") || 
          file.format?.toLowerCase()?.includes("x265") ||
          file.relPath.toLowerCase().includes("x265") ||
          file.relPath.toLowerCase().includes("hevc")) {
        return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    default:
      // Unknown format - try video copy with audio re-encode as safest option
      // If it fails, user can try full re-encode
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
  }
}

function escapeDoubleQuotes(value: string): string {
  return value.replace(/(["\\\\`$])/g, "\\$1");
}

function computeEndTime(
  start: string,
  file: string,
  files: MediaFile[],
): string {
  if (!isValidTime(start) || !file) return "--:--:--";
  const dur = files.find((f) => f.relPath === file)?.durationSeconds || 0;
  const startSec = timeToSeconds(start);
  const endSec = (startSec + dur) % 86400;
  return secondsToTime(endSec);
}

function computeEndTimeWithIndicator(
  start: string,
  file: string,
  files: MediaFile[],
): { time: string; crossesMidnight: boolean } {
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
  const h = hours.toString().padStart(2, "0");
  const m = minutes.toString().padStart(2, "0");
  const s = seconds.toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatNowUtc(): string {
  const now = new Date();
  return formatTimeFromParts(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
}

function formatThisHourUtc(): string {
  const now = new Date();
  return formatTimeFromParts(now.getUTCHours(), 0, 0);
}

function formatNextHourUtc(): string {
  const now = new Date();
  const nextHour = (now.getUTCHours() + 1) % 24;
  return formatTimeFromParts(nextHour, 0, 0);
}

function formatTimeFromParts(hours: number, minutes: number, seconds: number): string {
  return `${padTime(hours % 24)}:${padTime(minutes % 60)}:${padTime(seconds % 60)}`;
}

function padTime(value: number): string {
  return value.toString().padStart(2, "0");
}

