"use client";

import Link from "next/link";
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

type SourceConfig = {
  mediaRoot: string | null;
  effectiveMediaRoot: string | null;
  localMode: boolean;
  dataFolder: string | null;
  configured: boolean;
};

type LocalStatus = {
  mediaCount: number;
  channelCount: number;
  hasSchedule: boolean;
  loading: boolean;
};

export default function SourceAdminPage() {
  const [mediaSource, setMediaSource] = useState<MediaSource>("remote");
  const [pendingSource, setPendingSource] = useState<MediaSource>("remote");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushingAll, setPushingAll] = useState(false);
  const [remoteStatuses, setRemoteStatuses] = useState<RemoteFileStatus[]>([]);
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [pushingFile, setPushingFile] = useState<string | null>(null);
  
  // Folder configuration state
  const [sourceConfig, setSourceConfig] = useState<SourceConfig | null>(null);
  const [folderPath, setFolderPath] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanModal, setScanModal] = useState<{
    open: boolean;
    phase: "scanning" | "cleaning" | "done" | "error";
    scanCount?: number;
    cleanupStats?: {
      metadataEntriesRemoved: number;
      scheduleReferencesRemoved: number;
      affectedChannels: string[];
    };
    error?: string;
  }>({ open: false, phase: "scanning" });
  
  // Local status
  const [localStatus, setLocalStatus] = useState<LocalStatus>({
    mediaCount: 0,
    channelCount: 0,
    hasSchedule: false,
    loading: true,
  });
  
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

  // Load source config
  const loadSourceConfig = async () => {
    try {
      const res = await fetch("/api/source", { cache: "no-store" });
      if (res.ok) {
        const config = await res.json() as SourceConfig;
        setSourceConfig(config);
        setFolderPath(config.effectiveMediaRoot || "");
      }
    } catch (err) {
      console.warn("Failed to load source config:", err);
    }
  };

  // Load local status
  const loadLocalStatus = async () => {
    setLocalStatus(prev => ({ ...prev, loading: true }));
    try {
      const [mediaRes, channelsRes, scheduleRes] = await Promise.all([
        fetch(`/api/media-files?t=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/channels?source=local`, { cache: "no-store" }),
        fetch(`/api/schedule?source=local`, { cache: "no-store" }),
      ]);
      
      const mediaData = await mediaRes.json();
      const channelsData = await channelsRes.json();
      const scheduleData = await scheduleRes.json();
      
      setLocalStatus({
        mediaCount: mediaData?.items?.length || 0,
        channelCount: channelsData?.channels?.length || 0,
        hasSchedule: scheduleData?.schedule?.slots?.length > 0,
        loading: false,
      });
    } catch {
      setLocalStatus({ mediaCount: 0, channelCount: 0, hasSchedule: false, loading: false });
    }
  };

  useEffect(() => {
    void loadSourceConfig();
    void loadLocalStatus();
  }, []);

  // Check remote files status
  const checkRemoteFiles = async () => {
    setCheckingRemote(true);
    setRemoteStatuses([
      { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "checking" },
      { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "checking" },
    ]);

    try {
      const res = await fetch("/api/remote-status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        // Filter to only show the files we care about (not deprecated channels.json)
        const relevantFiles = (data.files || []).filter(
          (f: RemoteFileStatus) => f.file === "media-index.json" || f.file === "schedule.json"
        );
        setRemoteStatuses(relevantFiles);
      } else {
        setRemoteStatuses([
          { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "error", error: "API error" },
          { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "error", error: "API error" },
        ]);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Network error";
      setRemoteStatuses([
        { file: "media-index.json", url: `${REMOTE_MEDIA_BASE}media-index.json`, status: "error", error: errorMsg },
        { file: "schedule.json", url: `${REMOTE_MEDIA_BASE}schedule.json`, status: "error", error: errorMsg },
      ]);
    } finally {
      setCheckingRemote(false);
    }
  };

  // Check remote when switching to remote mode
  useEffect(() => {
    if (mediaSource === "remote") {
      void checkRemoteFiles();
    }
  }, [mediaSource]);

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
      if (!res.ok) throw new Error(data.error || "Failed to save folder");
      setFolderMessage(data.message || "Folder saved successfully");
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
      if (!res.ok) throw new Error(data.error || "Failed to clear folder");
      setFolderMessage("Folder configuration cleared");
      setFolderPath("");
      await loadSourceConfig();
      await loadLocalStatus();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Failed to clear folder");
    } finally {
      setSavingFolder(false);
    }
  };

  // Scan media folder and clean up orphaned entries
  const scanMediaFolder = async () => {
    setScanning(true);
    setFolderMessage(null);
    setFolderError(null);
    setScanModal({ open: true, phase: "scanning" });
    
    try {
      // Step 1: Scan media files
      const scanRes = await fetch("/api/media-index/local", { method: "POST" });
      const scanData = await scanRes.json();
      if (!scanRes.ok || !scanData.success) throw new Error(scanData.message || "Scan failed");
      
      const scanCount = scanData.count || 0;
      
      // Step 2: Clean up orphaned entries
      setScanModal({ open: true, phase: "cleaning", scanCount });
      const cleanupRes = await fetch("/api/media-index/cleanup", { method: "POST" });
      const cleanupData = await cleanupRes.json();
      
      // Show results
      const cleanupStats = cleanupRes.ok && cleanupData.success ? {
        metadataEntriesRemoved: cleanupData.stats?.metadataEntriesRemoved || 0,
        scheduleReferencesRemoved: cleanupData.stats?.scheduleReferencesRemoved || 0,
        affectedChannels: cleanupData.stats?.affectedChannels || [],
      } : { metadataEntriesRemoved: 0, scheduleReferencesRemoved: 0, affectedChannels: [] };
      
      setScanModal({ open: true, phase: "done", scanCount, cleanupStats });
      await loadLocalStatus();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Scan failed";
      setScanModal({ open: true, phase: "error", error: errorMsg });
      setFolderError(errorMsg);
    } finally {
      setScanning(false);
    }
  };
  
  const closeScanModal = () => {
    setScanModal({ open: false, phase: "scanning" });
  };

  // Folder browser
  const openFolderBrowser = () => {
    setShowBrowser(true);
    setBrowserError(null);
    void browseTo(folderPath || "");
  };

  const browseTo = async (targetPath: string) => {
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const url = targetPath ? `/api/browse?path=${encodeURIComponent(targetPath)}` : "/api/browse";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to browse");
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
      setMessage(`Media source set to ${pendingSource === "remote" ? "Remote" : "Local"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save source");
    } finally {
      setSaving(false);
    }
  };

  // Push all to remote
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

      // Push schedule (includes channel data)
      const scheduleRes = await fetch("/api/schedule/push", { method: "POST" });
      const scheduleData = await scheduleRes.json();
      if (!scheduleRes.ok || !scheduleData?.success) {
        throw new Error(scheduleData?.message || "Failed to upload schedule.json");
      }

      // Push channels.json for backwards compatibility
      const channelsRes = await fetch("/api/channels/push", { method: "POST" });
      const channelsData = await channelsRes.json();
      if (!channelsRes.ok || !channelsData?.success) {
        throw new Error(channelsData?.message || "Failed to upload channels.json");
      }

      setMessage("Pushed to remote: media-index.json, schedule.json, channels.json");
      void checkRemoteFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushingAll(false);
    }
  };

  // Push single file
  const pushSingleFile = async (file: string) => {
    setPushingFile(file);
    setMessage(null);
    setError(null);
    try {
      let endpoint = "";
      if (file === "media-index.json") endpoint = "/api/media-index/push";
      else if (file === "schedule.json") endpoint = "/api/schedule/push";
      else throw new Error(`Unknown file: ${file}`);

      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `Failed to upload ${file}`);
      }
      setMessage(`Pushed ${file} to remote`);
      void checkRemoteFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushingFile(null);
    }
  };

  const isConfigured = sourceConfig?.configured ?? false;

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-neutral-50">Media Source</h1>
        <p className="text-sm text-neutral-400">
          Configure where media and schedules are loaded from.
        </p>
      </div>

      {/* Source Selection */}
      <div className="rounded-md border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-xs uppercase text-neutral-400">Active Source</p>
            <p className="text-lg font-semibold text-neutral-50">
              {mediaSource === "remote" ? "Remote CDN" : "Local Files"}
            </p>
          </div>
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
            mediaSource === "remote" ? "bg-blue-500/20 text-blue-200" : "bg-emerald-500/20 text-emerald-200"
          }`}>
            {mediaSource === "remote" ? "CDN" : "Local"}
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
                {sourceConfig?.localMode && !isConfigured && (
                  <span className="rounded-full px-1.5 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-200">
                    Setup Required
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400">
                {isConfigured ? (
                  <>Media from <code className="bg-white/10 px-1 rounded">{sourceConfig?.effectiveMediaRoot}</code></>
                ) : (
                  "Point to a folder containing your media files"
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
                Media from <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code>
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

      {/* Media Folder Configuration - Only for local mode */}
      {sourceConfig?.localMode && pendingSource === "local" && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <div className="mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-neutral-100">Media Folder</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                isConfigured ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"
              }`}>
                {isConfigured ? "Configured" : "Setup Required"}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              Point to the folder containing your media files.
            </p>
          </div>

          {!isConfigured && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 mb-4">
              <p className="text-sm text-amber-100 font-medium mb-1">No folder configured</p>
              <p className="text-xs text-amber-200/70">
                Select a folder to get started. Data will be stored in <code className="bg-black/20 px-1 rounded">.remote-viewer/</code>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2">
              <label htmlFor="folder-path-input" className="sr-only">Media folder path</label>
              <input
                id="folder-path-input"
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/Volumes/MyDrive/Media"
                className="flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-400/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={openFolderBrowser}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
              >
                Browse
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void saveFolderPath()}
              disabled={savingFolder || !folderPath.trim()}
              className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {savingFolder ? "Saving…" : isConfigured ? "Update Folder" : "Set Folder"}
            </button>
            {isConfigured && (
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

          {(folderMessage || folderError) && (
            <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              folderMessage ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" : "border-red-300/40 bg-red-500/10 text-red-100"
            }`}>
              {folderMessage || folderError}
            </div>
          )}

          {isConfigured && sourceConfig?.dataFolder && (
            <div className="mt-4 rounded-lg border border-white/5 bg-neutral-950/50 p-3">
              <p className="text-xs text-neutral-500 mb-2">Data stored at:</p>
              <p className="font-mono text-xs text-neutral-300">{sourceConfig.dataFolder}</p>
            </div>
          )}
        </div>
      )}

      {/* Local Data Summary - Only when local is active */}
      {mediaSource === "local" && isConfigured && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-neutral-100">Local Data</h2>
            <button
              onClick={() => void loadLocalStatus()}
              disabled={localStatus.loading}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
            >
              {localStatus.loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-white/5 bg-white/5 p-3 text-center">
              <p className="text-2xl font-bold text-neutral-100">{localStatus.mediaCount}</p>
              <p className="text-xs text-neutral-400">Media Files</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/5 p-3 text-center">
              <p className="text-2xl font-bold text-neutral-100">{localStatus.channelCount}</p>
              <p className="text-xs text-neutral-400">Channels</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/5 p-3 text-center">
              <p className="text-2xl font-bold text-neutral-100">{localStatus.hasSchedule ? "✓" : "—"}</p>
              <p className="text-xs text-neutral-400">Schedules</p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Link
              href="/admin/data-health"
              className="text-xs text-blue-300 hover:text-blue-200 hover:underline"
            >
              Check data health →
            </Link>
          </div>
        </div>
      )}

      {/* Remote Status - Only when remote is active */}
      {mediaSource === "remote" && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">Remote Files</h2>
              <p className="text-xs text-neutral-400 mt-1">
                Files at <code className="bg-white/10 px-1 rounded">{REMOTE_MEDIA_BASE}</code>
              </p>
            </div>
            <button
              onClick={() => void checkRemoteFiles()}
              disabled={checkingRemote}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
            >
              {checkingRemote ? "Checking…" : "Refresh"}
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/5">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-neutral-200">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">File</th>
                  <th className="px-4 py-2 text-center font-semibold w-28">Status</th>
                  <th className="px-4 py-2 text-left font-semibold">Details</th>
                  <th className="px-4 py-2 text-center font-semibold w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/50">
                {remoteStatuses.map((item) => (
                  <tr key={item.file}>
                    <td className="px-4 py-3">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300 hover:text-blue-200 hover:underline"
                      >
                        {item.file}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
                        item.status === "found" ? "bg-emerald-500/20 text-emerald-100" :
                        item.status === "missing" ? "bg-red-500/20 text-red-100" :
                        item.status === "checking" ? "bg-neutral-500/20 text-neutral-300" :
                        "bg-amber-500/20 text-amber-100"
                      }`}>
                        {item.status === "checking" && <span className="w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />}
                        {item.status === "found" && "✓ Found"}
                        {item.status === "missing" && "✕ Missing"}
                        {item.status === "checking" && "Checking"}
                        {item.status === "error" && "⚠ Error"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {item.status === "found" && item.mediaCount !== undefined && `${item.mediaCount} files`}
                      {item.status === "found" && item.scheduleChannelCount !== undefined && `${item.scheduleChannelCount} channels`}
                      {item.status === "missing" && <span className="text-red-300">Not found</span>}
                      {item.status === "error" && <span className="text-amber-300">{item.error}</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => void pushSingleFile(item.file)}
                        disabled={pushingFile !== null}
                        className={`rounded-md px-2 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                          item.status === "missing"
                            ? "border border-emerald-300/50 bg-emerald-500/20 text-emerald-50 hover:border-emerald-200 hover:bg-emerald-500/30"
                            : "border border-white/15 bg-white/5 text-neutral-300 hover:border-white/30 hover:bg-white/10"
                        }`}
                      >
                        {pushingFile === item.file ? "Pushing…" : item.status === "missing" ? "Push" : "Update"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Push to Remote */}
      {mediaSource === "remote" && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <h2 className="text-sm font-semibold text-neutral-100 mb-1">Push to Remote</h2>
          <p className="text-xs text-neutral-400 mb-4">
            Upload local data to remote CDN via FTP.
          </p>

          <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-4">
            <p className="text-xs text-neutral-400 mb-2">Files pushed:</p>
            <div className="font-mono text-xs text-neutral-300 space-y-1">
              <p>├── media-index.json <span className="text-neutral-500">← media catalog</span></p>
              <p>├── schedule.json <span className="text-neutral-500">← channels + schedules (source of truth)</span></p>
              <p>└── channels.json <span className="text-neutral-500">← backwards compatibility</span></p>
            </div>
          </div>

          <button
            onClick={() => void pushEverythingToRemote()}
            disabled={pushingAll}
            className="rounded-md border border-blue-300/50 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
          >
            {pushingAll ? "Pushing…" : "Push All to Remote"}
          </button>

          {(message || error) && (
            <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              message ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" : "border-amber-300/40 bg-amber-500/10 text-amber-100"
            }`}>
              {message || error}
            </div>
          )}
        </div>
      )}

      {/* Folder Browser Modal */}
      {showBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowBrowser(false); }}
        >
          <div className="w-full max-w-xl rounded-md border border-white/15 bg-neutral-900 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">Select Media Folder</h3>
                <p className="text-xs text-neutral-400 mt-0.5 font-mono truncate max-w-md">
                  {browserPath || "Select a location"}
                </p>
              </div>
              <button onClick={() => setShowBrowser(false)} aria-label="Close folder browser" className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100">
                <svg className="h-5 w-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

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

            <div className="max-h-80 overflow-y-auto">
              {browserLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 border-2 border-neutral-400 border-t-emerald-400 rounded-full animate-spin" />
                  <span className="ml-2 text-sm text-neutral-400">Loading...</span>
                </div>
              ) : browserError ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-red-400">{browserError}</p>
                  <button onClick={() => void browseTo("")} className="mt-2 text-xs text-neutral-400 hover:text-neutral-200">
                    Back to roots
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {browserParent !== null && (
                    <button onClick={() => void browseTo(browserParent)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5 transition">
                      <svg className="h-5 w-5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                      </svg>
                      <span className="text-sm text-neutral-300">..</span>
                    </button>
                  )}
                  {browserEntries.length === 0 && !browserParent && (
                    <div className="px-4 py-8 text-center text-sm text-neutral-500">No folders found.</div>
                  )}
                  {browserEntries.map((entry) => (
                    <button key={entry.path} onClick={() => void browseTo(entry.path)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5 transition group">
                      <svg className="h-5 w-5 text-amber-400/70" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      <span className="flex-1 text-sm text-neutral-100 truncate">{entry.name}</span>
                      {entry.hasMediaFiles && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">has media</span>}
                      <svg className="h-4 w-4 text-neutral-600 group-hover:text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
              <p className="text-xs text-neutral-500 truncate max-w-xs">
                {browserPath ? `${browserEntries.length} folder${browserEntries.length === 1 ? "" : "s"}` : ""}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowBrowser(false)} className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10">
                  Cancel
                </button>
                <button
                  onClick={() => { if (browserPath) { setFolderPath(browserPath); setShowBrowser(false); } }}
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

      {/* Scan Progress Modal */}
      {scanModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={(e) => { if (e.target === e.currentTarget && scanModal.phase === "done") closeScanModal(); }}
        >
          <div className="w-full max-w-sm rounded-md border border-white/15 bg-neutral-900 shadow-2xl shadow-black/60">
            {/* Scanning Phase */}
            {scanModal.phase === "scanning" && (
              <div className="p-6 text-center">
                <div className="mx-auto mb-4 h-10 w-10 border-3 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
                <p className="text-sm font-semibold text-neutral-100">Scanning media folder...</p>
                <p className="text-xs text-neutral-400 mt-1">Finding and analyzing media files</p>
              </div>
            )}

            {/* Cleaning Phase */}
            {scanModal.phase === "cleaning" && (
              <div className="p-6 text-center">
                <div className="mx-auto mb-4 h-10 w-10 border-3 border-neutral-600 border-t-amber-400 rounded-full animate-spin" />
                <p className="text-sm font-semibold text-neutral-100">Cleaning up...</p>
                <p className="text-xs text-neutral-400 mt-1">
                  Found {scanModal.scanCount} files, removing orphaned entries
                </p>
              </div>
            )}

            {/* Done Phase */}
            {scanModal.phase === "done" && (
              <div className="p-6">
                <div className="flex items-center justify-center mb-4">
                  <div className="rounded-full bg-emerald-500/20 p-3">
                    <svg className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <p className="text-sm font-semibold text-neutral-100 text-center mb-4">Scan Complete</p>
                
                <div className="space-y-3">
                  {/* Files scanned */}
                  <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                    <span className="text-xs text-neutral-400">Media files found</span>
                    <span className="text-sm font-semibold text-neutral-100">{scanModal.scanCount}</span>
                  </div>
                  
                  {/* Cleanup results */}
                  {scanModal.cleanupStats && (
                    <>
                      {(scanModal.cleanupStats.metadataEntriesRemoved > 0 || scanModal.cleanupStats.scheduleReferencesRemoved > 0) ? (
                        <>
                          {scanModal.cleanupStats.metadataEntriesRemoved > 0 && (
                            <div className="flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
                              <span className="text-xs text-amber-200/70">Orphaned metadata removed</span>
                              <span className="text-sm font-semibold text-amber-200">{scanModal.cleanupStats.metadataEntriesRemoved}</span>
                            </div>
                          )}
                          {scanModal.cleanupStats.scheduleReferencesRemoved > 0 && (
                            <div className="flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
                              <span className="text-xs text-amber-200/70">Broken schedule refs removed</span>
                              <span className="text-sm font-semibold text-amber-200">{scanModal.cleanupStats.scheduleReferencesRemoved}</span>
                            </div>
                          )}
                          {scanModal.cleanupStats.affectedChannels.length > 0 && (
                            <p className="text-xs text-neutral-500 text-center">
                              Affected channels: {scanModal.cleanupStats.affectedChannels.join(", ")}
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center justify-center rounded-lg bg-emerald-500/10 px-3 py-2">
                          <span className="text-xs text-emerald-200">No orphaned entries found</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                
                <button
                  onClick={closeScanModal}
                  className="mt-4 w-full rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                >
                  Done
                </button>
              </div>
            )}

            {/* Error Phase */}
            {scanModal.phase === "error" && (
              <div className="p-6">
                <div className="flex items-center justify-center mb-4">
                  <div className="rounded-full bg-red-500/20 p-3">
                    <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                </div>
                <p className="text-sm font-semibold text-neutral-100 text-center mb-2">Scan Failed</p>
                <p className="text-xs text-red-300 text-center mb-4">{scanModal.error}</p>
                
                <button
                  onClick={closeScanModal}
                  className="w-full rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
