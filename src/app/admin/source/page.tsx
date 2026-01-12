"use client";

import { useEffect, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

type RemoteFileStatus = {
  file: string;
  url: string;
  status: "checking" | "found" | "missing" | "error";
  mediaCount?: number;
  channelCount?: number;
  scheduleChannelCount?: number;
  error?: string;
};

type LocalStatus = {
  mediaFolder: boolean;
  dataFolder: boolean;
  mediaIndexExists: boolean;
  channelsExists: boolean;
  scheduleExists: boolean;
  mediaCount: number;
  channelCount: number;
  loading: boolean;
};

type RemoteStatus = {
  connected: boolean;
  mediaIndexExists: boolean;
  channelsExists: boolean;
  scheduleExists: boolean;
  mediaCount: number;
  channelCount: number;
  loading: boolean;
  error?: string;
};

type SourceConfig = {
  mediaRoot: string | null;
  effectiveMediaRoot: string | null;
  localMode: boolean;
  dataFolder: string | null;
  configured: boolean;
};

export default function SourceAdminPage() {
  // Default to "remote" so fresh browsers work immediately with deployed apps
  const [mediaSource, setMediaSource] = useState<MediaSource>("remote");
  const [pendingSource, setPendingSource] = useState<MediaSource>("remote");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushingAll, setPushingAll] = useState(false);
  const [remoteStatuses, setRemoteStatuses] = useState<RemoteFileStatus[]>([]);
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [pushingFile, setPushingFile] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalStatus>({
    mediaFolder: false,
    dataFolder: false,
    mediaIndexExists: false,
    channelsExists: false,
    scheduleExists: false,
    mediaCount: 0,
    channelCount: 0,
    loading: true,
  });
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>({
    connected: false,
    mediaIndexExists: false,
    channelsExists: false,
    scheduleExists: false,
    mediaCount: 0,
    channelCount: 0,
    loading: true,
  });
  
  // Folder configuration state
  const [sourceConfig, setSourceConfig] = useState<SourceConfig | null>(null);
  const [folderPath, setFolderPath] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  
  // Folder browser state
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState("");
  const [browserEntries, setBrowserEntries] = useState<{ name: string; path: string; hasMediaFiles?: boolean }[]>([]);
  const [browserRoots, setBrowserRoots] = useState<{ name: string; path: string }[]>([]);
  const [browserParent, setBrowserParent] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);

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

  // Load local source status
  const loadLocalStatus = async () => {
    setLocalStatus(prev => ({ ...prev, loading: true }));
    try {
      // Check media files
      const mediaRes = await fetch(`/api/media-files?t=${Date.now()}`, { cache: "no-store" });
      const mediaData = await mediaRes.json();
      
      // Check channels
      const channelsRes = await fetch(`/api/channels?source=local`, { cache: "no-store" });
      const channelsData = await channelsRes.json();
      
      // Check schedule
      const scheduleRes = await fetch(`/api/schedule?source=local`, { cache: "no-store" });
      const scheduleData = await scheduleRes.json();
      
      setLocalStatus({
        mediaFolder: true,
        dataFolder: true,
        mediaIndexExists: mediaData?.items !== undefined,
        channelsExists: Array.isArray(channelsData?.channels),
        scheduleExists: scheduleData !== undefined,
        mediaCount: mediaData?.items?.length || 0,
        channelCount: channelsData?.channels?.length || 0,
        loading: false,
      });
    } catch (err) {
      setLocalStatus({
        mediaFolder: false,
        dataFolder: false,
        mediaIndexExists: false,
        channelsExists: false,
        scheduleExists: false,
        mediaCount: 0,
        channelCount: 0,
        loading: false,
      });
    }
  };

  // Load remote source status
  const loadRemoteStatus = async () => {
    setRemoteStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch("/api/remote-status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const files = data.files || [];
        
        const mediaIndex = files.find((f: RemoteFileStatus) => f.file === "media-index.json");
        const channelsFile = files.find((f: RemoteFileStatus) => f.file === "channels.json");
        const scheduleFile = files.find((f: RemoteFileStatus) => f.file === "schedule.json");
        
        setRemoteStatus({
          connected: true,
          mediaIndexExists: mediaIndex?.status === "found",
          channelsExists: channelsFile?.status === "found",
          scheduleExists: scheduleFile?.status === "found",
          mediaCount: mediaIndex?.mediaCount || 0,
          channelCount: channelsFile?.channelCount || 0,
          loading: false,
        });
      } else {
        throw new Error("Failed to fetch remote status");
      }
    } catch (err) {
      setRemoteStatus({
        connected: false,
        mediaIndexExists: false,
        channelsExists: false,
        scheduleExists: false,
        mediaCount: 0,
        channelCount: 0,
        loading: false,
        error: err instanceof Error ? err.message : "Connection failed",
      });
    }
  };

  // Load status on mount and when source changes
  useEffect(() => {
    void loadLocalStatus();
    void loadRemoteStatus();
  }, []);

  // Load source config (folder settings)
  const loadSourceConfig = async () => {
    try {
      const res = await fetch("/api/source", { cache: "no-store" });
      if (res.ok) {
        const config = await res.json() as SourceConfig;
        setSourceConfig(config);
        // Set folder path from config
        setFolderPath(config.effectiveMediaRoot || "");
      }
    } catch (err) {
      console.warn("Failed to load source config:", err);
    }
  };

  useEffect(() => {
    void loadSourceConfig();
  }, []);

  // Save folder path
  const saveFolderPath = async () => {
    if (!folderPath.trim()) {
      setFolderError("Please enter a folder path");
      return;
    }
    
    setSavingFolder(true);
    setFolderMessage(null);
    setFolderError(null);
    try {
      const res = await fetch("/api/source", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaRoot: folderPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save folder");
      }
      setFolderMessage(data.message || "Folder saved successfully");
      // Reload config and status
      await loadSourceConfig();
      await loadLocalStatus();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Failed to save folder");
    } finally {
      setSavingFolder(false);
    }
  };

  // Clear folder configuration
  const clearFolderConfig = async () => {
    setSavingFolder(true);
    setFolderMessage(null);
    setFolderError(null);
    try {
      const res = await fetch("/api/source", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaRoot: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to clear folder");
      }
      setFolderMessage("Folder configuration cleared");
      setFolderPath("");
      // Reload config and status
      await loadSourceConfig();
      await loadLocalStatus();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Failed to clear folder");
    } finally {
      setSavingFolder(false);
    }
  };

  // Scan media folder and create index
  const scanMediaFolder = async () => {
    setScanning(true);
    setFolderMessage(null);
    setFolderError(null);
    try {
      const res = await fetch("/api/media-index/local", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Scan failed");
      }
      setFolderMessage(data.message || `Scanned ${data.count} files`);
      // Reload status to show updated counts
      await loadLocalStatus();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  // Folder browser functions
  const openFolderBrowser = () => {
    setShowBrowser(true);
    setBrowserError(null);
    // Start from current folder path or load roots
    if (folderPath) {
      void browseTo(folderPath);
    } else {
      void browseTo("");
    }
  };

  const browseTo = async (targetPath: string) => {
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const url = targetPath
        ? `/api/browse?path=${encodeURIComponent(targetPath)}`
        : "/api/browse";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to browse");
      }
      setBrowserPath(data.currentPath || "");
      setBrowserEntries(data.entries || []);
      setBrowserRoots(data.roots || []);
      setBrowserParent(data.parentPath || null);
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : "Failed to browse");
    } finally {
      setBrowserLoading(false);
    }
  };

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

  // Check remote files when switching to remote
  useEffect(() => {
    if (mediaSource === "remote") {
      void checkRemoteFiles();
    }
  }, [mediaSource]);

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
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-neutral-50">Media Source</h1>
        <p className="text-sm text-neutral-400">
          Switch between local files and remote CDN. Each source has its own media catalog and schedules.
        </p>
      </div>

      {/* Source Selection */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">Active Source</p>
            <p className="text-lg font-semibold text-neutral-50">
              {mediaSource === "remote" ? "Remote" : "Local"}
            </p>
            {mediaSource === "remote" && (
              <p className="text-xs text-neutral-400 font-mono">{REMOTE_MEDIA_BASE}</p>
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
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-neutral-100">Local</p>
                  {sourceConfig?.localMode && !sourceConfig?.configured && (
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-200">
                      Setup Required
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-400">
                  {sourceConfig?.configured ? (
                    <>
                      Media from{" "}
                      <code className="bg-white/10 px-1 rounded">
                        {sourceConfig.effectiveMediaRoot}
                      </code>
                    </>
                  ) : (
                    <>Point to a folder containing your media files</>
                  )}
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
              <p className="font-semibold text-neutral-100">Remote</p>
              <p className="text-xs text-neutral-400">
                Media + schedules from <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code>
              </p>
            </div>
          </label>
        </div>

        {pendingSource !== mediaSource && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={saveSource}
              disabled={saving}
              className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Apply Source"}
            </button>
            <button
              onClick={() => setPendingSource(mediaSource)}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Media Folder Configuration - Only shown in local mode */}
      {sourceConfig?.localMode && pendingSource === "local" && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <div className="mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-neutral-100">Media Folder</h2>
              {sourceConfig.configured ? (
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-200">
                  Configured
                </span>
              ) : (
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-200">
                  Setup Required
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              Point to the folder containing your media files. This can be an external drive or any folder on your system.
            </p>
          </div>

          {/* Not configured state */}
          {!sourceConfig.configured && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 mb-4">
              <p className="text-sm text-amber-100 font-medium mb-1">No folder configured</p>
              <p className="text-xs text-amber-200/70">
                Select a folder to get started with local mode. Your schedules and settings will be stored in a <code className="bg-black/20 px-1 rounded">.remote-viewer</code> subfolder.
              </p>
            </div>
          )}

          {/* Folder path input */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/Volumes/MyDrive/Media or ~/Movies"
                className="flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-400/50 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
              />
              <button
                type="button"
                onClick={openFolderBrowser}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
              >
                Browse
              </button>
            </div>
            {folderPath && (
              <p className="text-xs text-neutral-500">
                Data files will be stored in <code className="bg-white/10 px-1 rounded">{folderPath}/.remote-viewer/</code>
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void saveFolderPath()}
              disabled={savingFolder || !folderPath.trim()}
              className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {savingFolder ? "Saving…" : sourceConfig.configured ? "Update Folder" : "Set Folder"}
            </button>
            {sourceConfig.configured && (
              <>
                <button
                  onClick={() => void scanMediaFolder()}
                  disabled={scanning}
                  className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
                >
                  {scanning ? "Scanning…" : "Scan Media"}
                </button>
                <button
                  onClick={() => void clearFolderConfig()}
                  disabled={savingFolder}
                  className="rounded-md border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-200 transition hover:border-red-300/50 hover:bg-red-500/20 disabled:opacity-50"
                >
                  Clear
                </button>
              </>
            )}
          </div>

          {/* Folder status messages */}
          {(folderMessage || folderError) && (
            <div
              className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                folderMessage
                  ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                  : "border-red-300/40 bg-red-500/10 text-red-100"
              }`}
            >
              {folderMessage || folderError}
            </div>
          )}

          {/* Current config info - only show when configured */}
          {sourceConfig.configured && sourceConfig.effectiveMediaRoot && (
            <div className="mt-4 rounded-lg border border-white/5 bg-neutral-950/50 p-3">
              <p className="text-xs text-neutral-500 mb-2">Current configuration:</p>
              <div className="space-y-1 font-mono text-xs text-neutral-300">
                <p>
                  Media folder:{" "}
                  <span className="text-neutral-100">{sourceConfig.effectiveMediaRoot}</span>
                </p>
                {sourceConfig.dataFolder && (
                  <p>
                    Data folder:{" "}
                    <span className="text-neutral-100">{sourceConfig.dataFolder}</span>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Local Source Status */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-neutral-100">Local Source Status</h2>
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-200">
              Local Files
            </span>
          </div>
          <button
            onClick={() => void loadLocalStatus()}
            disabled={localStatus.loading}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
          >
            {localStatus.loading ? "Checking…" : "Refresh Status"}
          </button>
        </div>

        {localStatus.loading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            <div className="w-4 h-4 border-2 border-neutral-400 border-t-emerald-400 rounded-full animate-spin" />
            <span>Loading local status...</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Connection Status */}
            <div className="rounded-lg border border-white/5 bg-white/5 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-400">Connection</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  localStatus.mediaFolder && localStatus.dataFolder
                    ? "bg-emerald-500/20 text-emerald-100"
                    : "bg-red-500/20 text-red-100"
                }`}>
                  {localStatus.mediaFolder && localStatus.dataFolder ? "✓ Connected" : "✕ Not Found"}
                </span>
              </div>
              <div className="space-y-1 text-xs text-neutral-400">
                <p>Media folder: <code className="bg-white/10 px-1 rounded">./media</code></p>
                <p>Data folder: <code className="bg-white/10 px-1 rounded">./data</code></p>
              </div>
            </div>

            {/* Files Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-neutral-400">Media Index</span>
                  <span className={`inline-flex items-center rounded-full w-2 h-2 ${
                    localStatus.mediaIndexExists ? "bg-emerald-400" : "bg-red-400"
                  }`} />
                </div>
                <p className="text-lg font-semibold text-neutral-100">{localStatus.mediaCount}</p>
                <p className="text-xs text-neutral-500">media files</p>
              </div>

              <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-neutral-400">Channels</span>
                  <span className={`inline-flex items-center rounded-full w-2 h-2 ${
                    localStatus.channelsExists ? "bg-emerald-400" : "bg-red-400"
                  }`} />
                </div>
                <p className="text-lg font-semibold text-neutral-100">{localStatus.channelCount}</p>
                <p className="text-xs text-neutral-500">channels</p>
              </div>

              <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-neutral-400">Schedule</span>
                  <span className={`inline-flex items-center rounded-full w-2 h-2 ${
                    localStatus.scheduleExists ? "bg-emerald-400" : "bg-red-400"
                  }`} />
                </div>
                <p className="text-lg font-semibold text-neutral-100">
                  {localStatus.scheduleExists ? "Active" : "None"}
                </p>
                <p className="text-xs text-neutral-500">schedule.json</p>
              </div>
            </div>

            {/* File Paths */}
            <div className="rounded-lg border border-white/5 bg-neutral-950/50 p-3">
              <p className="text-xs text-neutral-500 mb-2">Local file paths:</p>
              <div className="space-y-1 font-mono text-xs text-neutral-300">
                <p>./media/ <span className="text-neutral-500">← media files</span></p>
                <p>./data/local/media-index.json <span className="text-neutral-500">← {localStatus.mediaCount} files</span></p>
                <p>./data/local/channels.json <span className="text-neutral-500">← {localStatus.channelCount} channels</span></p>
                <p>./data/local/schedule.json <span className="text-neutral-500">← schedules</span></p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Remote Source Status */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-neutral-100">Remote Source Status</h2>
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-200">
              CDN
            </span>
          </div>
          <button
            onClick={() => void loadRemoteStatus()}
            disabled={remoteStatus.loading}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
          >
            {remoteStatus.loading ? "Checking…" : "Refresh Status"}
          </button>
        </div>

        {remoteStatus.loading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            <div className="w-4 h-4 border-2 border-neutral-400 border-t-blue-400 rounded-full animate-spin" />
            <span>Checking remote connection...</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Connection Status */}
            <div className="rounded-lg border border-white/5 bg-white/5 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-400">Connection</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  remoteStatus.connected
                    ? "bg-emerald-500/20 text-emerald-100"
                    : "bg-red-500/20 text-red-100"
                }`}>
                  {remoteStatus.connected ? "✓ Connected" : "✕ Connection Failed"}
                </span>
              </div>
              <div className="space-y-1 text-xs text-neutral-400">
                <p>Remote URL: <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code></p>
                {remoteStatus.error && (
                  <p className="text-amber-300">Error: {remoteStatus.error}</p>
                )}
              </div>
            </div>

            {/* Files Status */}
            {remoteStatus.connected && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-neutral-400">Media Index</span>
                      <span className={`inline-flex items-center rounded-full w-2 h-2 ${
                        remoteStatus.mediaIndexExists ? "bg-emerald-400" : "bg-amber-400"
                      }`} />
                    </div>
                    <p className="text-lg font-semibold text-neutral-100">{remoteStatus.mediaCount}</p>
                    <p className="text-xs text-neutral-500">media files</p>
                  </div>

                  <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-neutral-400">Channels</span>
                      <span className={`inline-flex items-center rounded-full w-2 h-2 ${
                        remoteStatus.channelsExists ? "bg-emerald-400" : "bg-amber-400"
                      }`} />
                    </div>
                    <p className="text-lg font-semibold text-neutral-100">{remoteStatus.channelCount}</p>
                    <p className="text-xs text-neutral-500">channels</p>
                  </div>

                  <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-neutral-400">Schedule</span>
                      <span className={`inline-flex items-center rounded-full w-2 h-2 ${
                        remoteStatus.scheduleExists ? "bg-emerald-400" : "bg-amber-400"
                      }`} />
                    </div>
                    <p className="text-lg font-semibold text-neutral-100">
                      {remoteStatus.scheduleExists ? "Active" : "Missing"}
                    </p>
                    <p className="text-xs text-neutral-500">schedule.json</p>
                  </div>
                </div>

                {/* Remote Paths */}
                <div className="rounded-lg border border-white/5 bg-neutral-950/50 p-3">
                  <p className="text-xs text-neutral-500 mb-2">Remote file paths:</p>
                  <div className="space-y-1 font-mono text-xs text-neutral-300">
                    <p>{REMOTE_MEDIA_BASE} <span className="text-neutral-500">← media files</span></p>
                    <p>{REMOTE_MEDIA_BASE}media-index.json <span className="text-neutral-500">← {remoteStatus.mediaCount} files</span></p>
                    <p>{REMOTE_MEDIA_BASE}channels.json <span className="text-neutral-500">← {remoteStatus.channelCount} channels</span></p>
                    <p>{REMOTE_MEDIA_BASE}schedule.json <span className="text-neutral-500">← schedules</span></p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Remote Status Check */}
      {mediaSource === "remote" && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-neutral-100">Remote File Status</h3>
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-200">
                CDN
              </span>
            </div>
            <button
              onClick={() => void checkRemoteFiles()}
              disabled={checkingRemote}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
            >
              {checkingRemote ? "Checking…" : "Refresh Status"}
            </button>
          </div>
          <p className="mb-3 text-xs text-neutral-400">
            Checking required JSON files at <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code>
          </p>
          
          {remoteStatuses.length === 0 && !checkingRemote ? (
            <p className="text-sm text-neutral-400">Click &quot;Refresh Status&quot; to check remote files.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-white/5">
              <table className="min-w-full text-sm text-left">
                <thead className="bg-white/5 text-neutral-200">
                  <tr>
                    <th className="px-3 py-2 font-semibold">File</th>
                    <th className="px-3 py-2 font-semibold w-32 text-center">Status</th>
                    <th className="px-3 py-2 font-semibold text-left">Details</th>
                    <th className="px-3 py-2 font-semibold w-24 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-neutral-950/40 text-neutral-100">
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
                              ? "bg-neutral-500/20 text-neutral-300"
                              : "bg-amber-500/20 text-amber-100"
                          }`}
                        >
                          {item.status === "checking" && (
                            <span className="inline-block w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                          )}
                          {item.status === "found" && "✓ Found"}
                          {item.status === "missing" && "✕ Missing"}
                          {item.status === "checking" && "Checking"}
                          {item.status === "error" && "⚠ Error"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-neutral-400 text-xs">
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
                            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-300 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
                            title="Update this file on remote"
                          >
                            {pushingFile === item.file ? "Pushing…" : "Update"}
                          </button>
                        )}
                        {item.status === "checking" && (
                          <span className="text-xs text-neutral-500">—</span>
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

      {/* Push to Remote - Only shown when remote is active */}
      {mediaSource === "remote" && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <h2 className="text-sm font-semibold text-neutral-100 mb-1">Push to Remote</h2>
          <p className="text-xs text-neutral-400 mb-4">
            Upload local data to your remote CDN via FTP. This syncs your local schedules and media catalog to the remote source.
          </p>

          <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-4">
            <p className="text-xs text-neutral-400 mb-2">3 JSON files per media source:</p>
            <div className="font-mono text-xs text-neutral-300 space-y-1">
              <p>├── media-index.json <span className="text-neutral-500">← media file index</span></p>
              <p>├── channels.json <span className="text-neutral-500">← channel list</span></p>
              <p>├── schedule.json <span className="text-neutral-500">← all channel schedules</span></p>
              <p>└── *.mp4, *.mkv, ... <span className="text-neutral-500">← media files</span></p>
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
      )}

      {/* Folder Browser Modal */}
      {showBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowBrowser(false);
          }}
        >
          <div className="w-full max-w-xl rounded-xl border border-white/15 bg-neutral-900 shadow-2xl shadow-black/60">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">Select Media Folder</h3>
                <p className="text-xs text-neutral-400 mt-0.5 font-mono truncate max-w-md">
                  {browserPath || "Select a location"}
                </p>
              </div>
              <button
                onClick={() => setShowBrowser(false)}
                className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Quick access roots */}
            {browserRoots.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-white/10 px-4 py-2">
                {browserRoots.map((root) => (
                  <button
                    key={root.path}
                    onClick={() => void browseTo(root.path)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                      browserPath === root.path
                        ? "bg-emerald-500/20 text-emerald-100 border border-emerald-400/40"
                        : "bg-white/5 text-neutral-300 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {root.name}
                  </button>
                ))}
              </div>
            )}

            {/* Directory listing */}
            <div className="max-h-80 overflow-y-auto">
              {browserLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 border-2 border-neutral-400 border-t-emerald-400 rounded-full animate-spin" />
                  <span className="ml-2 text-sm text-neutral-400">Loading...</span>
                </div>
              ) : browserError ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-red-400">{browserError}</p>
                  <button
                    onClick={() => void browseTo("")}
                    className="mt-2 text-xs text-neutral-400 hover:text-neutral-200"
                  >
                    Back to roots
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {/* Parent directory */}
                  {browserParent !== null && (
                    <button
                      onClick={() => void browseTo(browserParent)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5 transition"
                    >
                      <svg className="h-5 w-5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                      </svg>
                      <span className="text-sm text-neutral-300">..</span>
                    </button>
                  )}
                  
                  {/* Directories */}
                  {browserEntries.length === 0 && !browserParent && (
                    <div className="px-4 py-8 text-center text-sm text-neutral-500">
                      No folders found. Select a root location above.
                    </div>
                  )}
                  {browserEntries.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => void browseTo(entry.path)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5 transition group"
                    >
                      <svg className="h-5 w-5 text-amber-400/70" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      <span className="flex-1 text-sm text-neutral-100 truncate">{entry.name}</span>
                      {entry.hasMediaFiles && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                          has media
                        </span>
                      )}
                      <svg className="h-4 w-4 text-neutral-600 group-hover:text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer with actions */}
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
              <p className="text-xs text-neutral-500 truncate max-w-xs">
                {browserPath ? `${browserEntries.length} folder${browserEntries.length === 1 ? "" : "s"}` : ""}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowBrowser(false)}
                  className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (browserPath) {
                      setFolderPath(browserPath);
                      setShowBrowser(false);
                    }
                  }}
                  disabled={!browserPath}
                  className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1.5 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  Select This Folder
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


