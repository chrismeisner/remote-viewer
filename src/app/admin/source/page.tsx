"use client";

import { useEffect, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

type MediaItem = {
  relPath: string;
  durationSeconds?: number;
  format?: string;
  supported?: boolean;
  supportedViaCompanion?: boolean;
  title?: string;
};

type RemoteFileStatus = {
  file: string;
  url: string;
  status: "checking" | "found" | "missing" | "error";
  mediaCount?: number;
  channelCount?: number;
  scheduleChannelCount?: number;
  error?: string;
};

export default function SourceAdminPage() {
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [pendingSource, setPendingSource] = useState<MediaSource>("local");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushingAll, setPushingAll] = useState(false);
  const [syncingLocalJson, setSyncingLocalJson] = useState(false);
  const [files, setFiles] = useState<MediaItem[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaRefreshToken, setMediaRefreshToken] = useState(0);
  const [forceMediaRefresh, setForceMediaRefresh] = useState(false);
  const [remoteStatuses, setRemoteStatuses] = useState<RemoteFileStatus[]>([]);
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [pushingFile, setPushingFile] = useState<string | null>(null);
  const [scanningRemote, setScanningRemote] = useState(false);

  // Load and sync media source preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      if (stored === "remote" || stored === "local") {
        setMediaSource(stored);
        setPendingSource(stored);
      }
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(MEDIA_SOURCE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(MEDIA_SOURCE_EVENT, sync);
    };
  }, []);

  // Load channels list
  useEffect(() => {
    const loadChannels = async () => {
      try {
        const res = await fetch(`/api/channels?source=local`);
        if (res.ok) {
          const data = await res.json();
          setChannels(data.channels || []);
        }
      } catch {
        // ignore
      }
    };
    void loadChannels();
  }, []);

  // Load media list for selected source
  useEffect(() => {
    let cancelled = false;
    const shouldForceRefresh = forceMediaRefresh;
    if (forceMediaRefresh) setForceMediaRefresh(false);
    setLoadingMedia(true);
    setError(null);

    const load = async () => {
      try {
        let filesJson: { items?: MediaItem[] } = {};
        if (mediaSource === "remote") {
          const manifestRes = await fetch(
            `/api/media-index?base=${encodeURIComponent(REMOTE_MEDIA_BASE)}&t=${Date.now()}`,
            { cache: "no-store" },
          );
          if (!manifestRes.ok) {
            const text = await manifestRes.text();
            throw new Error(text || "Failed to load remote manifest");
          }
          filesJson = await manifestRes.json();
        } else {
          const params = new URLSearchParams();
          if (shouldForceRefresh) params.set("refresh", "1");
          params.set("t", String(Date.now()));
          const filesRes = await fetch(
            `/api/media-files?${params.toString()}`,
            { cache: "no-store" },
          );
          filesJson = await filesRes.json();
        }
        if (!cancelled) {
          setFiles(filesJson.items || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load media");
          setFiles([]);
        }
      } finally {
        if (!cancelled) setLoadingMedia(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [mediaSource, mediaRefreshToken, forceMediaRefresh]);

  const saveSource = () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      setMediaSource(pendingSource);
      if (typeof window !== "undefined") {
        localStorage.setItem(MEDIA_SOURCE_KEY, pendingSource);
        window.dispatchEvent(new Event(MEDIA_SOURCE_EVENT));
      }
      setMessage(
        `Media source set to ${pendingSource === "remote" ? "Remote" : "Local"}${
          pendingSource === "remote" ? ` (${REMOTE_MEDIA_BASE})` : ""
        }`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save source");
    } finally {
      setSaving(false);
    }
  };

  const pushEverythingToRemote = async () => {
    setPushingAll(true);
    setMessage(null);
    setError(null);
    try {
      // Push media index
      const manifestRes = await fetch("/api/media-index/push", { method: "POST" });
      const manifestData = await manifestRes.json();
      if (!manifestRes.ok || !manifestData?.success) {
        throw new Error(manifestData?.message || "Failed to upload media-index.json");
      }

      // Push channels
      const channelsRes = await fetch("/api/channels/push", { method: "POST" });
      const channelsData = await channelsRes.json();
      if (!channelsRes.ok || !channelsData?.success) {
        throw new Error(channelsData?.message || "Failed to upload channels.json");
      }

      // Push schedule (single file with all channels)
      const scheduleRes = await fetch("/api/schedule/push", { method: "POST" });
      const scheduleData = await scheduleRes.json();
      if (!scheduleRes.ok || !scheduleData?.success) {
        throw new Error(scheduleData?.message || "Failed to upload schedule.json");
      }

      setMessage("Pushed to remote: media-index.json, channels.json, schedule.json");
      // Refresh status after push
      if (mediaSource === "remote") {
        void checkRemoteFiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushingAll(false);
    }
  };

  const syncLocalJson = async () => {
    setSyncingLocalJson(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/media-index/local", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Sync failed");
      }
      setMessage(data.message || "Saved media-index.json");
      // Refresh the media list after syncing
      refreshMediaList({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingLocalJson(false);
    }
  };

  const refreshMediaList = (opts?: { force?: boolean }) => {
    if (opts?.force) setForceMediaRefresh(true);
    setMediaRefreshToken((token) => token + 1);
  };

  // Scan remote media folder via FTP and regenerate media-index.json
  const scanRemoteMedia = async () => {
    setScanningRemote(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/media-index/scan-remote", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Scan failed");
      }
      setMessage(data.message || `Scanned remote and found ${data.count} files`);
      // Refresh the media list and status after scanning
      refreshMediaList();
      void checkRemoteFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanningRemote(false);
    }
  };

  // Check remote JSON files status via server-side API (avoids CORS issues)
  const checkRemoteFiles = async () => {
    setCheckingRemote(true);
    
    // Initialize with checking status
    setRemoteStatuses([
      { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "checking" },
      { file: "channels.json", url: `${REMOTE_MEDIA_BASE}channels.json`, status: "checking" },
      { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "checking" },
    ]);

    try {
      const res = await fetch("/api/remote-status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRemoteStatuses(data.files || []);
      } else {
        // If API fails, mark all as error
        setRemoteStatuses([
          { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "error", error: "API error" },
          { file: "channels.json", url: `${REMOTE_MEDIA_BASE}channels.json`, status: "error", error: "API error" },
          { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "error", error: "API error" },
        ]);
      }
    } catch (err) {
      setRemoteStatuses([
        { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "error", error: err instanceof Error ? err.message : "Network error" },
        { file: "channels.json", url: `${REMOTE_MEDIA_BASE}channels.json`, status: "error", error: err instanceof Error ? err.message : "Network error" },
        { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "error", error: err instanceof Error ? err.message : "Network error" },
      ]);
    } finally {
      setCheckingRemote(false);
    }
  };

  // Check remote files when switching to remote or on refresh
  useEffect(() => {
    if (mediaSource === "remote") {
      void checkRemoteFiles();
    }
  }, [mediaSource, mediaRefreshToken]);

  // Push a single file to remote
  const pushSingleFile = async (file: string) => {
    setPushingFile(file);
    setMessage(null);
    setError(null);
    try {
      if (file === "media-index.json") {
        const res = await fetch("/api/media-index/push", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || "Failed to upload media-index.json");
        }
      } else if (file === "channels.json") {
        const res = await fetch("/api/channels/push", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || "Failed to upload channels.json");
        }
      } else if (file === "schedule.json") {
        const res = await fetch("/api/schedule/push", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || "Failed to upload schedule.json");
        }
      }
      setMessage(`Pushed ${file} to remote`);
      // Refresh the status after pushing
      void checkRemoteFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushingFile(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-slate-50">Media Source</h1>
        <p className="text-sm text-slate-400">
          Switch between local files and remote CDN. Each source has its own media catalog and schedules.
        </p>
      </div>

      {/* Source Selection */}
      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5 shadow-lg shadow-black/30">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Active Source</p>
            <p className="text-lg font-semibold text-slate-50">
              {mediaSource === "remote" ? "Remote" : "Local"}
            </p>
            {mediaSource === "remote" && (
              <p className="text-xs text-slate-400 font-mono">{REMOTE_MEDIA_BASE}</p>
            )}
          </div>
          <div
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              mediaSource === "remote"
                ? "bg-blue-500/20 text-blue-200"
                : "bg-emerald-500/20 text-emerald-200"
            }`}
          >
            {mediaSource === "remote" ? "CDN" : "Local Files"}
          </div>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3 cursor-pointer hover:bg-white/10 transition">
            <input
              type="radio"
              name="media-source"
              value="local"
              checked={pendingSource === "local"}
              onChange={() => setPendingSource("local")}
              className="h-4 w-4 mt-0.5"
            />
            <div>
              <p className="font-semibold text-slate-100">Local</p>
              <p className="text-xs text-slate-400">
                Media from <code className="bg-white/10 px-1 rounded">./media</code>, config from{" "}
                <code className="bg-white/10 px-1 rounded">data/</code>
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3 cursor-pointer hover:bg-white/10 transition">
            <input
              type="radio"
              name="media-source"
              value="remote"
              checked={pendingSource === "remote"}
              onChange={() => setPendingSource("remote")}
              className="h-4 w-4 mt-0.5"
            />
            <div>
              <p className="font-semibold text-slate-100">Remote</p>
              <p className="text-xs text-slate-400">
                Media + schedules from <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code>
              </p>
            </div>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={saveSource}
            disabled={saving || pendingSource === mediaSource}
            className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Apply Source"}
          </button>
          {pendingSource !== mediaSource && (
            <button
              onClick={() => setPendingSource(mediaSource)}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Push to Remote */}
      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5 shadow-lg shadow-black/30">
        <h2 className="text-sm font-semibold text-slate-100 mb-1">Push to Remote</h2>
        <p className="text-xs text-slate-400 mb-4">
          Upload local data to your remote CDN via FTP. This syncs your local schedules and media catalog to the remote source.
        </p>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-4">
          <p className="text-xs text-slate-400 mb-2">3 JSON files per media source:</p>
          <div className="font-mono text-xs text-slate-300 space-y-1">
            <p>├── media-index.json <span className="text-slate-500">← media file index</span></p>
            <p>├── channels.json <span className="text-slate-500">← channel list</span></p>
            <p>├── schedule.json <span className="text-slate-500">← all channel schedules</span></p>
            <p>└── *.mp4, *.mkv, ... <span className="text-slate-500">← media files</span></p>
          </div>
        </div>

        <button
          onClick={() => void pushEverythingToRemote()}
          disabled={pushingAll}
          className="rounded-md border border-blue-300/50 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
        >
          {pushingAll ? "Pushing…" : "Push to Remote"}
        </button>

        {(message || error) && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              message
                ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                : "border-amber-300/40 bg-amber-500/10 text-amber-100"
            }`}
          >
            {message || error}
          </div>
        )}
      </div>

      {/* Remote Status Check */}
      {mediaSource === "remote" && (
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 shadow-lg shadow-black/30">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-slate-100">Remote File Status</h3>
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-200">
                CDN
              </span>
            </div>
            <button
              onClick={() => void checkRemoteFiles()}
              disabled={checkingRemote}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
            >
              {checkingRemote ? "Checking…" : "Refresh Status"}
            </button>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Checking required JSON files at <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code>
          </p>
          
          {remoteStatuses.length === 0 && !checkingRemote ? (
            <p className="text-sm text-slate-400">Click &quot;Refresh Status&quot; to check remote files.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-white/5">
              <table className="min-w-full text-sm text-left">
                <thead className="bg-white/5 text-slate-200">
                  <tr>
                    <th className="px-3 py-2 font-semibold">File</th>
                    <th className="px-3 py-2 font-semibold w-32 text-center">Status</th>
                    <th className="px-3 py-2 font-semibold text-left">Details</th>
                    <th className="px-3 py-2 font-semibold w-24 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-slate-950/40 text-slate-100">
                  {remoteStatuses.map((item) => (
                    <tr key={item.file}>
                      <td className="px-3 py-2">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-300 hover:text-blue-200 hover:underline"
                        >
                          {item.file}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
                            item.status === "found"
                              ? "bg-emerald-500/20 text-emerald-100"
                              : item.status === "missing"
                              ? "bg-red-500/20 text-red-100"
                              : item.status === "checking"
                              ? "bg-slate-500/20 text-slate-300"
                              : "bg-amber-500/20 text-amber-100"
                          }`}
                        >
                          {item.status === "checking" && (
                            <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                          )}
                          {item.status === "found" && "✓ Found"}
                          {item.status === "missing" && "✕ Missing"}
                          {item.status === "checking" && "Checking"}
                          {item.status === "error" && "⚠ Error"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400 text-xs">
                        {item.status === "found" && item.mediaCount !== undefined && (
                          <span>{item.mediaCount} media file{item.mediaCount === 1 ? "" : "s"}</span>
                        )}
                        {item.status === "found" && item.channelCount !== undefined && (
                          <span>{item.channelCount} channel{item.channelCount === 1 ? "" : "s"}</span>
                        )}
                        {item.status === "found" && item.scheduleChannelCount !== undefined && (
                          <span>{item.scheduleChannelCount} channel schedule{item.scheduleChannelCount === 1 ? "" : "s"}</span>
                        )}
                        {item.status === "missing" && (
                          <span className="text-red-300">Not found on remote</span>
                        )}
                        {item.status === "error" && (
                          <span className="text-amber-300">{item.error}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.status === "missing" && (
                          <button
                            onClick={() => void pushSingleFile(item.file)}
                            disabled={pushingFile !== null}
                            className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                          >
                            {pushingFile === item.file ? "Pushing…" : "Push"}
                          </button>
                        )}
                        {item.status === "found" && (
                          <button
                            onClick={() => void pushSingleFile(item.file)}
                            disabled={pushingFile !== null}
                            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-slate-300 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
                            title="Update this file on remote"
                          >
                            {pushingFile === item.file ? "Pushing…" : "Update"}
                          </button>
                        )}
                        {item.status === "checking" && (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {/* Summary */}
          {remoteStatuses.length > 0 && !checkingRemote && (
            <div className="mt-3 flex items-center gap-4 text-xs">
              <span className="text-emerald-300">
                ✓ {remoteStatuses.filter((s) => s.status === "found").length} found
              </span>
              {remoteStatuses.filter((s) => s.status === "missing").length > 0 && (
                <span className="text-red-300">
                  ✕ {remoteStatuses.filter((s) => s.status === "missing").length} missing
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Media List (both local and remote) */}
      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 shadow-lg shadow-black/30">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-100">
              {mediaSource === "remote" ? "Remote Media" : "Local Media"}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                mediaSource === "remote"
                  ? "bg-blue-500/20 text-blue-200"
                  : "bg-emerald-500/20 text-emerald-200"
              }`}
            >
              {mediaSource === "remote" ? "CDN" : "Local"}
            </span>
            <span className="text-xs text-slate-400">
              {files.length} file{files.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshMediaList()}
              disabled={loadingMedia}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
            >
              {loadingMedia ? "Loading…" : "Refresh"}
            </button>
            {mediaSource === "local" && (
              <button
                onClick={() => void syncLocalJson()}
                disabled={syncingLocalJson || loadingMedia}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                title="Rescan media folder and save to data/media-index.json"
              >
                {syncingLocalJson ? "Syncing…" : "Rescan & Save"}
              </button>
            )}
            {mediaSource === "remote" && (
              <button
                onClick={() => void scanRemoteMedia()}
                disabled={scanningRemote || loadingMedia}
                className="rounded-md border border-blue-300/50 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                title="Scan remote folder via FTP and regenerate media-index.json"
              >
                {scanningRemote ? "Scanning…" : "Rescan Remote"}
              </button>
            )}
          </div>
        </div>
        <div className="mb-3 text-xs text-slate-400">
          {mediaSource === "local" ? (
            <>
              <p>Source: <code className="bg-white/10 px-1 rounded">./media</code> folder</p>
              <p>Index: <code className="bg-white/10 px-1 rounded">data/media-index.json</code></p>
            </>
          ) : (
            <>
              <p>Source: <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code></p>
              <p>Index: <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}media-index.json</code></p>
            </>
          )}
        </div>
        {loadingMedia ? (
          <p className="text-sm text-slate-300">Loading media…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-slate-300">
            {mediaSource === "remote"
              ? "No media found on remote. Check that media-index.json exists."
              : "No media found. Add files to ./media and click \"Rescan & Save\"."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/5">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-white/5 text-slate-200">
                <tr>
                  <th className="px-3 py-2 font-semibold">File</th>
                  <th className="px-3 py-2 font-semibold w-24 text-left">Format</th>
                  <th className="px-3 py-2 font-semibold w-28 text-left">Supported</th>
                  <th className="px-3 py-2 font-semibold w-28 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-950/40 text-slate-100">
                {files.map((file) => (
                  <tr key={file.relPath}>
                    <td className="px-3 py-2">
                      <span className="text-left break-all">{file.relPath}</span>
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
                      {formatDuration(file.durationSeconds || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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


