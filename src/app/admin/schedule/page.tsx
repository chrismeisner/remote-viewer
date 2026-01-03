"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_CHANNEL } from "@/constants/channels";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";
import { DailySchedule, ScheduleSlot, validateSchedule } from "@/lib/schedule";

type MediaFile = {
  relPath: string;
  title: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
};

export default function ScheduleAdminPage() {
  return (
    <Suspense fallback={<div className="p-4 text-slate-200">Loading...</div>}>
      <ScheduleAdminContent />
    </Suspense>
  );
}

function ScheduleAdminContent() {
  const searchParams = useSearchParams();
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [modalStart, setModalStart] = useState("00:00:00");
  const [modalEnd, setModalEnd] = useState("00:00:00");
  const [modalFile, setModalFile] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [channel, setChannel] = useState(
    () => searchParams.get("channel") ?? DEFAULT_CHANNEL,
  );
  const [channels, setChannels] = useState<string[]>([DEFAULT_CHANNEL]);
  const [newChannelName, setNewChannelName] = useState("");
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [modalSource, setModalSource] = useState<MediaSource>("local");
  const [changingSource, setChangingSource] = useState(false);

  // Sync channel from URL if provided
  useEffect(() => {
    const urlChannel = searchParams.get("channel");
    if (urlChannel && urlChannel !== channel) {
      setChannel(urlChannel);
    }
  }, [searchParams, channel]);

  // Load media source preference from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
    if (stored === "remote" || stored === "local") {
      setMediaSource(stored);
    }
  }, []);

  const handleSourceChange = (value: MediaSource) => {
    setMediaSource(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(MEDIA_SOURCE_KEY, value);
      window.dispatchEvent(new Event(MEDIA_SOURCE_EVENT));
    }
  };

  const handleSourceSave = () => {
    handleSourceChange(modalSource);
    setChangingSource(true);
  };

  // Load available channels and media list once
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setError(null);

    const load = async () => {
      try {
        const channelsRes = await fetch(`/api/channels`);
        const channelsJson = await channelsRes.json();
        const channelNames =
          Array.isArray(channelsJson.channels) && channelsJson.channels.length > 0
            ? channelsJson.channels
            : ["default"];

        let filesJson: { items?: MediaFile[] } = {};
        if (mediaSource === "remote") {
          try {
            const remoteUrl = new URL("media-index.json", REMOTE_MEDIA_BASE).toString();
            const manifestRes = await fetch(remoteUrl);
            filesJson = await manifestRes.json();
          } catch (err) {
            console.warn("Remote manifest fetch failed", err);
            throw new Error("Failed to load remote media index");
          }
        } else {
          const filesRes = await fetch(`/api/media-files`);
          filesJson = await filesRes.json();
        }

        if (!cancelled) {
          setFiles(filesJson.items || []);
          setChannels(channelNames);
          if (!channelNames.includes(channel)) {
            const fallback = channelNames.includes(DEFAULT_CHANNEL)
              ? DEFAULT_CHANNEL
              : channelNames[0];
            setChannel(fallback);
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

  // Close modal when source change finishes loading
  useEffect(() => {
    if (changingSource && !loading) {
      setChangingSource(false);
      setShowSourceModal(false);
    }
  }, [changingSource, loading]);

  // Reload schedule when channel changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setError(null);

    const loadSchedule = async () => {
      try {
        const res = await fetch(`/api/schedule?channel=${encodeURIComponent(channel)}`);
        const schedJson = await res.json();
        if (!cancelled) {
          const savedSlots = schedJson?.schedule?.slots ?? [];
          setSlots(Array.isArray(savedSlots) ? savedSlots : []);
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
  }, [channel]);

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) =>
        a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" }),
      ),
    [files],
  );

  const fileByRel = useMemo(() => {
    const map = new Map<string, MediaFile>();
    for (const f of sortedFiles) map.set(f.relPath, f);
    return map;
  }, [sortedFiles]);

  const totalDurationSeconds = useMemo(
    () => sortedFiles.reduce((sum, f) => sum + (f.durationSeconds || 0), 0),
    [sortedFiles],
  );

  const addSlot = () => {
    const defaultFile = sortedFiles[0]?.relPath || "";
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

  const updateSlot = (index: number, slot: ScheduleSlot) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? slot : s)));
  };

  const persistSchedule = async (slotsToPersist: ScheduleSlot[]) => {
    setSaving(true);
    setMessage(null);
    setError(null);

    const normalized = [...slotsToPersist].sort(
      (a, b) => timeToSeconds(a.start) - timeToSeconds(b.start),
    );

    const body: DailySchedule = { slots: normalized };
    try {
      validateSchedule(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid schedule");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/schedule?channel=${encodeURIComponent(channel)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }

      setMessage(
        `Saved schedule for channel "${channel}" at ${new Date().toLocaleTimeString()}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const removeSlot = (index: number) => {
    const nextSlots = slots.filter((_, i) => i !== index);
    setSlots(nextSlots);
    void persistSchedule(nextSlots);
  };

  const scheduleNext = (slot: ScheduleSlot) => {
    const nextStart = incrementTime(slot.end, 1);
    const file = sortedFiles.find((f) => f.relPath === slot.file)
      ? slot.file
      : sortedFiles[0]?.relPath || "";
    setModalFile(file);
    setModalStart(nextStart);
    setModalEnd(computeEndTime(nextStart, file, sortedFiles));
    setShowSlotModal(true);
  };

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-300">
            Schedule Admin
          </p>
          <p className="text-sm text-slate-400">
            Single-day (24h, UTC) schedule per channel. Saves directly to local JSON; no external
            sync or Airtable.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Add slots, then hit Save schedule. Media is read from your MEDIA_ROOT on this machine.
          </p>
        </div>
      </div>
      {showSourceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowSourceModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-white/15 bg-slate-900 p-5 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-100">Select media source</h4>
              <button
                onClick={() => setShowSourceModal(false)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-200">
              <label className="block">
                Source
                <select
                  value={modalSource}
                  onChange={(e) => setModalSource(e.target.value as MediaSource)}
                  className="mt-1 w-full rounded-md bg-slate-900 border border-white/15 px-2 py-2 text-sm"
                >
                  <option value="local">Local</option>
                  <option value="remote">Remote ({REMOTE_MEDIA_BASE})</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSourceModal(false)}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleSourceSave}
                disabled={changingSource}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {changingSource ? "Changing…" : "Save & reload"}
              </button>
            </div>
          </div>
        </div>
      )}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-300">Media source</span>
            <span className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-slate-100">
              {mediaSource === "remote" ? `Remote (${REMOTE_MEDIA_BASE})` : "Local"}
            </span>
            <button
              onClick={() => {
                setModalSource(mediaSource);
                setShowSourceModal(true);
              }}
              className="rounded-md border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/40 hover:bg-white/15"
            >
              Change source
            </button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-slate-300">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              disabled={loadingChannels}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-slate-100"
            >
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder="New channel name"
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <button
              onClick={() => {
                const trimmed = newChannelName.trim();
                if (!trimmed) return;
                setChannel(trimmed);
                setNewChannelName("");
                setSlots([]);
                setMessage(
                  `Switched to channel "${trimmed}". Add schedule items and save.`,
                );
              }}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
            >
              Switch/Create
            </button>
          </div>
          <button
            onClick={addSlot}
            className="rounded-md border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/15"
            disabled={loading || saving}
          >
            + Add schedule item
          </button>
          <button
            onClick={() => void persistSchedule(slots)}
            className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            disabled={loading || saving || slots.length === 0}
          >
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-300">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 shadow-lg shadow-black/30">
              {slots.length === 0 ? (
                <p className="text-sm text-slate-300">
                  No schedule items yet. Add the first item to build a 24h schedule.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/50">
                  <table className="min-w-full text-sm">
                    <thead className="bg-white/5 text-slate-200">
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
                          const duration = fileByRel.get(slot.file)?.durationSeconds || 0;
                          return (
                            <tr key={idx} className="bg-slate-950/60 text-slate-100">
                              <td className="px-3 py-2">
                                <input
                                  type="time"
                                  step="1"
                                  className="w-24 rounded-md bg-slate-900 border border-white/10 px-2 py-1 text-sm"
                                  value={slot.start}
                                  onChange={(e) =>
                                    updateSlot(idx, { ...slot, start: e.target.value })
                                  }
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="time"
                                  step="1"
                                  className="w-24 rounded-md bg-slate-900 border border-white/10 px-2 py-1 text-sm"
                                  value={slot.end}
                                  onChange={(e) =>
                                    updateSlot(idx, { ...slot, end: e.target.value })
                                  }
                                />
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  className="w-full rounded-md bg-slate-900 border border-white/10 px-2 py-1 text-sm"
                                  value={slot.file}
                                  onChange={(e) =>
                                    updateSlot(idx, { ...slot, file: e.target.value })
                                  }
                                >
                                  {sortedFiles.map((file) => (
                                    <option key={file.relPath} value={file.relPath}>
                                      {file.relPath} ({formatDuration(file.durationSeconds)})
                                    </option>
                                  ))}
                                  {sortedFiles.length === 0 && (
                                    <option value="">No files in library</option>
                                  )}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-right text-slate-300">
                                {duration ? formatDuration(duration) : "—"}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => scheduleNext(slot)}
                                    className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/40 hover:bg-white/15"
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

            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 shadow-lg shadow-black/30">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">
                  Available media
                </h3>
                <span className="text-xs text-slate-400">
                  {sortedFiles.length} file{sortedFiles.length === 1 ? "" : "s"}
                </span>
              </div>
              {sortedFiles.length === 0 ? (
                <p className="text-sm text-slate-300">
                  No media found in your library. Add files to your media folder.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-white/5">
                  <table className="min-w-full text-sm text-left">
                    <thead className="bg-white/5 text-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-semibold">File</th>
                        <th className="px-3 py-2 font-semibold w-24 text-left">
                          Format
                        </th>
                        <th className="px-3 py-2 font-semibold w-28 text-left">
                          Supported
                        </th>
                        <th className="px-3 py-2 font-semibold w-28 text-right">
                          Duration
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 bg-slate-950/40 text-slate-100">
                      {sortedFiles.map((file) => (
                        <tr key={file.relPath}>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-left underline decoration-dotted underline-offset-2 hover:text-emerald-200"
                              onClick={() => setSelectedFile(file)}
                            >
                              {file.relPath}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-left text-slate-200 uppercase">
                            {file.format || "—"}
                          </td>
                          <td className="px-3 py-2 text-left">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                file.supported
                                  ? "bg-emerald-500/20 text-emerald-100"
                                  : "bg-amber-500/20 text-amber-100"
                              }`}
                            >
                              {file.supported
                                ? file.supportedViaCompanion
                                  ? "Yes (companion)"
                                  : "Yes"
                                : "No"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-200">
                            {formatDuration(file.durationSeconds)}
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
        {error && <p className="text-sm text-amber-300">{error}</p>}
      {showSlotModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowSlotModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/15 bg-slate-900 p-5 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-100">
                Add schedule item
              </h4>
              <button
                onClick={() => setShowSlotModal(false)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-slate-200">
              <label className="block">
                Media
                <select
                  className="mt-1 w-full rounded-md bg-slate-900 border border-white/10 px-2 py-2 text-sm"
                  value={modalFile}
                  onChange={(e) => setModalFile(e.target.value)}
                >
                  {sortedFiles.map((file) => (
                    <option key={file.relPath} value={file.relPath}>
                      {file.relPath} ({formatDuration(file.durationSeconds)})
                    </option>
                  ))}
                  {sortedFiles.length === 0 && (
                    <option value="">No files in library</option>
                  )}
                </select>
              </label>

              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-300">
                  Start time
                  <input
                    type="time"
                    step="1"
                    value={modalStart}
                    onChange={(e) => {
                      setModalStart(e.target.value);
                      setModalEnd(
                        computeEndTime(e.target.value, modalFile, sortedFiles),
                      );
                    }}
                    className="ml-2 rounded-md bg-slate-900 border border-white/10 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  End time
                  <input
                    type="time"
                    step="1"
                    value={modalEnd}
                    onChange={(e) => setModalEnd(e.target.value)}
                    className="ml-2 rounded-md bg-slate-900 border border-white/10 px-2 py-1 text-sm"
                  />
                </label>
                <div className="text-xs text-slate-300">
                  Suggested end
                  <div className="mt-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-slate-100">
                    {computeEndTime(modalStart, modalFile, sortedFiles)}
                  </div>
                </div>
              </div>

              {sortedFiles.length === 0 && (
                <p className="text-xs text-amber-300">
                  Add media to your library before creating a schedule item.
                </p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSlotModal(false)}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
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
                      timeToSeconds(modalEnd) <= timeToSeconds(modalStart)
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
                    await persistSchedule(nextSlots);
                    setShowSlotModal(false);
                  })();
                }}
                disabled={!modalFile || !isValidTime(modalStart)}
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
            className="w-full max-w-lg rounded-xl border border-white/15 bg-slate-900 p-5 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-100">Media details</h4>
              <button
                onClick={() => setSelectedFile(null)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-2 text-sm text-slate-100">
              <div>
                <p className="text-xs uppercase text-slate-400">File</p>
                <p className="font-mono break-all">{selectedFile.relPath}</p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="rounded-full bg-white/10 px-3 py-1 text-slate-100">
                  Format: {selectedFile.format || "—"}
                </span>
                <span
                  className={`rounded-full px-3 py-1 font-semibold ${
                    selectedFile.supported
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "bg-amber-500/20 text-amber-100"
                  }`}
                >
                  {selectedFile.supported
                    ? selectedFile.supportedViaCompanion
                      ? "Supported (companion)"
                      : "Supported"
                    : "Not supported"}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-slate-100">
                  Duration: {formatDuration(selectedFile.durationSeconds)}
                </span>
              </div>

              {selectedFile.supported || selectedFile.supportedViaCompanion ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-slate-300">Quick preview (muted):</p>
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
                  <p className="text-xs text-slate-300">
                    Copy an ffmpeg command to make a browser-friendly MP4 (AAC audio).
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyConvertCommand(selectedFile, setCopiedCommand)}
                      className="rounded-md border border-white/20 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30"
                    >
                      {copiedCommand ? "Copied!" : "Copy conversion command"}
                    </button>
                    <code className="hidden sm:block rounded-md bg-black/40 px-3 py-2 text-xs text-slate-100">
                      ffmpeg -i "media/…" -c:v copy -c:a aac …
                    </code>
                  </div>
                </div>
              )}
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

function shouldShowConvert(file: MediaFile): boolean {
  if (file.supportedViaCompanion) return false;
  return file.format === "mkv" || !file.supported;
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
  const escapedOut = escapeDoubleQuotes(`${base}.aac.mp4`);
  return `ffmpeg -i "media/${escapedIn}" -c:v copy -c:a aac -b:a 192k -movflags +faststart "media/${escapedOut}"`;
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

function secondsToTime(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  const h = hours.toString().padStart(2, "0");
  const m = minutes.toString().padStart(2, "0");
  const s = seconds.toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

