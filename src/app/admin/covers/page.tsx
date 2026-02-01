"use client";

import { useEffect, useState, useCallback } from "react";
import {
  MEDIA_SOURCE_KEY,
  type MediaSource,
} from "@/constants/media";

type CoverFile = {
  filename: string;
  url: string;
};

type MediaItem = {
  relPath: string;
  title?: string;
  durationSeconds: number;
};

type MediaMetadata = {
  title?: string | null;
  coverUrl?: string | null;
  coverLocal?: string | null;
};

type CoverStatus = "none" | "local" | "url" | "broken-local";

type MediaCoverInfo = {
  relPath: string;
  title: string;
  coverStatus: CoverStatus;
  coverValue: string | null;
  resolvedUrl: string | null;
};

type HealthStats = {
  totalMedia: number;
  withCover: number;
  withoutCover: number;
  withLocalCover: number;
  withUrlCover: number;
  brokenLocalCovers: number;
  totalLocalCovers: number;
  orphanedCovers: number;
};

type FolderConfig = {
  coversFolder: string | null;
  customCoversFolder: string | null;
  isCustomFolder: boolean;
};

export default function CoversPage() {
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Data
  const [localCovers, setLocalCovers] = useState<CoverFile[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [metadata, setMetadata] = useState<Record<string, MediaMetadata>>({});
  const [mediaCoverInfo, setMediaCoverInfo] = useState<MediaCoverInfo[]>([]);
  const [healthStats, setHealthStats] = useState<HealthStats | null>(null);
  
  // Folder config
  const [folderConfig, setFolderConfig] = useState<FolderConfig | null>(null);
  const [folderPath, setFolderPath] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  
  // Folder browser
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState("");
  const [browserEntries, setBrowserEntries] = useState<{ name: string; path: string }[]>([]);
  const [browserRoots, setBrowserRoots] = useState<{ name: string; path: string }[]>([]);
  const [browserParent, setBrowserParent] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  
  // Filters
  const [coverFilter, setCoverFilter] = useState<"all" | "with-cover" | "without-cover" | "broken">("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Selected cover for details
  const [selectedCover, setSelectedCover] = useState<string | null>(null);

  // Load media source from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
    if (stored === "local" || stored === "remote") {
      setMediaSource(stored);
    }
  }, []);

  // Fetch all data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch in parallel: local covers (with config), media items, metadata
      const [coversRes, mediaRes, metadataRes] = await Promise.all([
        fetch("/api/covers?config=true"),
        fetch(`/api/media-files?source=${mediaSource}`),
        fetch("/api/media-metadata"),
      ]);
      
      const [coversData, mediaData, metadataData] = await Promise.all([
        coversRes.json(),
        mediaRes.json(),
        metadataRes.json(),
      ]);
      
      if (!coversRes.ok) throw new Error(coversData.error || "Failed to load covers");
      if (!mediaRes.ok) throw new Error(mediaData.error || "Failed to load media");
      if (!metadataRes.ok) throw new Error(metadataData.error || "Failed to load metadata");
      
      // Set folder config
      setFolderConfig({
        coversFolder: coversData.coversFolder || null,
        customCoversFolder: coversData.customCoversFolder || null,
        isCustomFolder: coversData.isCustomFolder || false,
      });
      setFolderPath(coversData.customCoversFolder || coversData.coversFolder || "");
      
      const covers: CoverFile[] = coversData.covers || [];
      const media: MediaItem[] = mediaData.files || [];
      const meta: Record<string, MediaMetadata> = metadataData.items || {};
      
      setLocalCovers(covers);
      setMediaItems(media);
      setMetadata(meta);
      
      // Build cover info for each media item
      const coverFilenames = new Set(covers.map((c) => c.filename));
      const usedCovers = new Set<string>();
      
      const coverInfo: MediaCoverInfo[] = media.map((item) => {
        const itemMeta = meta[item.relPath] || {};
        let coverStatus: CoverStatus = "none";
        let coverValue: string | null = null;
        let resolvedUrl: string | null = null;
        
        if (itemMeta.coverUrl) {
          coverStatus = "url";
          coverValue = itemMeta.coverUrl;
          resolvedUrl = itemMeta.coverUrl;
        } else if (itemMeta.coverLocal) {
          coverValue = itemMeta.coverLocal;
          if (coverFilenames.has(itemMeta.coverLocal)) {
            coverStatus = "local";
            resolvedUrl = `/api/covers/${encodeURIComponent(itemMeta.coverLocal)}`;
            usedCovers.add(itemMeta.coverLocal);
          } else {
            coverStatus = "broken-local";
          }
        }
        
        return {
          relPath: item.relPath,
          title: itemMeta.title || item.title || item.relPath.split("/").pop() || item.relPath,
          coverStatus,
          coverValue,
          resolvedUrl,
        };
      });
      
      setMediaCoverInfo(coverInfo);
      
      // Calculate health stats
      const withCover = coverInfo.filter((c) => c.coverStatus !== "none").length;
      const withLocalCover = coverInfo.filter((c) => c.coverStatus === "local").length;
      const withUrlCover = coverInfo.filter((c) => c.coverStatus === "url").length;
      const brokenLocalCovers = coverInfo.filter((c) => c.coverStatus === "broken-local").length;
      const orphanedCovers = covers.filter((c) => !usedCovers.has(c.filename)).length;
      
      setHealthStats({
        totalMedia: media.length,
        withCover,
        withoutCover: media.length - withCover,
        withLocalCover,
        withUrlCover,
        brokenLocalCovers,
        totalLocalCovers: covers.length,
        orphanedCovers,
      });
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [mediaSource]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle cover upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    setUploadError(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch("/api/covers", {
        method: "POST",
        body: formData,
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      
      // Refresh data
      await fetchData();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Handle cover delete
  const handleDeleteCover = async (filename: string) => {
    if (!confirm(`Delete cover "${filename}"? This cannot be undone.`)) return;
    
    try {
      const res = await fetch(`/api/covers/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }
      
      await fetchData();
      setSelectedCover(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

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
      const res = await fetch("/api/covers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coversFolder: folderPath }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save folder");
      
      setFolderMessage(data.message || "Folder saved successfully");
      await fetchData();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Failed to save folder");
    } finally {
      setSavingFolder(false);
    }
  };

  // Clear folder configuration (use default)
  const clearFolderConfig = async () => {
    setSavingFolder(true);
    setFolderMessage(null);
    setFolderError(null);
    
    try {
      const res = await fetch("/api/covers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coversFolder: null }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to clear folder");
      
      setFolderMessage("Covers folder reset to default");
      await fetchData();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Failed to clear folder");
    } finally {
      setSavingFolder(false);
    }
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

  // Filter media items
  const filteredMedia = mediaCoverInfo.filter((item) => {
    // Cover status filter
    if (coverFilter === "with-cover" && item.coverStatus === "none") return false;
    if (coverFilter === "without-cover" && item.coverStatus !== "none") return false;
    if (coverFilter === "broken" && item.coverStatus !== "broken-local") return false;
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!item.title.toLowerCase().includes(query) && !item.relPath.toLowerCase().includes(query)) {
        return false;
      }
    }
    
    return true;
  });

  // Get media items using a specific cover
  const getMediaUsingCover = (filename: string) => {
    return mediaCoverInfo.filter(
      (item) => item.coverStatus === "local" && item.coverValue === filename
    );
  };

  // Get orphaned covers
  const orphanedCovers = localCovers.filter((cover) => {
    return !mediaCoverInfo.some(
      (item) => item.coverStatus === "local" && item.coverValue === cover.filename
    );
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Covers</h1>
        <p className="text-neutral-400">Loading cover data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Covers</h1>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-red-300">{error}</p>
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-red-200 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Covers</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Manage cover images for your media library
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Source:</span>
          <span className={`text-xs font-medium px-2 py-1 rounded ${
            mediaSource === "local" ? "bg-emerald-500/20 text-emerald-300" : "bg-blue-500/20 text-blue-300"
          }`}>
            {mediaSource === "local" ? "Local" : "Remote"}
          </span>
        </div>
      </div>

      {/* Health Stats */}
      {healthStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard label="Total Media" value={healthStats.totalMedia} />
          <StatCard label="With Cover" value={healthStats.withCover} color="emerald" />
          <StatCard label="No Cover" value={healthStats.withoutCover} color={healthStats.withoutCover > 0 ? "amber" : "neutral"} />
          <StatCard label="Local Covers" value={healthStats.withLocalCover} color="blue" />
          <StatCard label="URL Covers" value={healthStats.withUrlCover} color="purple" />
          <StatCard label="Broken Links" value={healthStats.brokenLocalCovers} color={healthStats.brokenLocalCovers > 0 ? "red" : "neutral"} />
          <StatCard label="Cover Files" value={healthStats.totalLocalCovers} />
          <StatCard label="Orphaned" value={healthStats.orphanedCovers} color={healthStats.orphanedCovers > 0 ? "amber" : "neutral"} />
        </div>
      )}

      {/* Covers Folder Configuration - Only for local source */}
      {mediaSource === "local" && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <div className="mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-neutral-100">Covers Folder</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                folderConfig?.isCustomFolder ? "bg-blue-500/20 text-blue-200" : "bg-neutral-500/20 text-neutral-300"
              }`}>
                {folderConfig?.isCustomFolder ? "Custom" : "Default"}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              {folderConfig?.isCustomFolder
                ? "Using custom folder for cover images"
                : "Using default location within media folder"}
            </p>
          </div>

          {folderConfig?.coversFolder && (
            <div className="rounded-lg border border-white/5 bg-neutral-950/50 p-3 mb-4">
              <p className="text-xs text-neutral-500 mb-1">Current location:</p>
              <p className="font-mono text-xs text-neutral-300 break-all">{folderConfig.coversFolder}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder={folderConfig?.coversFolder || "/path/to/covers"}
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
              {savingFolder ? "Saving…" : "Set Custom Folder"}
            </button>
            {folderConfig?.isCustomFolder && (
              <button
                onClick={() => void clearFolderConfig()}
                disabled={savingFolder}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-neutral-300 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
              >
                Use Default
              </button>
            )}
          </div>

          {(folderMessage || folderError) && (
            <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              folderMessage ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" : "border-red-300/40 bg-red-500/10 text-red-100"
            }`}>
              {folderMessage || folderError}
            </div>
          )}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Local Covers Library */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Local Covers</h2>
            <label className="cursor-pointer rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-neutral-900 transition flex items-center gap-1.5">
              {uploading ? (
                "Uploading..."
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload
                </>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
          </div>
          
          {uploadError && (
            <p className="text-xs text-red-300 bg-red-500/10 px-3 py-2 rounded">{uploadError}</p>
          )}
          
          {localCovers.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-sm text-neutral-400">No local covers yet</p>
              <p className="text-xs text-neutral-500 mt-1">Upload images to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-[600px] overflow-y-auto pr-1">
              {localCovers.map((cover) => {
                const usageCount = getMediaUsingCover(cover.filename).length;
                const isOrphaned = usageCount === 0;
                const isSelected = selectedCover === cover.filename;
                
                return (
                  <button
                    key={cover.filename}
                    onClick={() => setSelectedCover(isSelected ? null : cover.filename)}
                    className={`relative aspect-[2/3] rounded-lg overflow-hidden border-2 transition ${
                      isSelected
                        ? "border-emerald-400"
                        : isOrphaned
                        ? "border-amber-500/50 hover:border-amber-400"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    <img
                      src={cover.url}
                      alt={cover.filename}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/offline.jpg";
                      }}
                    />
                    {/* Usage badge */}
                    <span className={`absolute top-1 right-1 text-xs font-bold px-1.5 py-0.5 rounded ${
                      isOrphaned
                        ? "bg-amber-500/80 text-amber-950"
                        : "bg-black/70 text-white"
                    }`}>
                      {usageCount}
                    </span>
                    {/* Filename overlay on hover */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 opacity-0 hover:opacity-100 transition">
                      <p className="text-xs text-white truncate">{cover.filename}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          
          {/* Selected Cover Details */}
          {selectedCover && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-200 truncate">{selectedCover}</p>
                  <p className="text-xs text-neutral-500">
                    Used by {getMediaUsingCover(selectedCover).length} media items
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteCover(selectedCover)}
                  className="text-xs text-red-400 hover:text-red-300 transition"
                >
                  Delete
                </button>
              </div>
              
              {getMediaUsingCover(selectedCover).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-neutral-500">Linked to:</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {getMediaUsingCover(selectedCover).map((item) => (
                      <p key={item.relPath} className="text-xs text-neutral-300 truncate">
                        {item.title}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Orphaned Covers Warning */}
          {orphanedCovers.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm font-medium text-amber-200">
                  {orphanedCovers.length} orphaned cover{orphanedCovers.length !== 1 ? "s" : ""}
                </p>
              </div>
              <p className="text-xs text-amber-300/70">
                These covers are not linked to any media items
              </p>
            </div>
          )}
        </div>

        {/* Right: Media Coverage Table */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Media Coverage</h2>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search media..."
                className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 w-40"
              />
              <select
                value={coverFilter}
                onChange={(e) => setCoverFilter(e.target.value as typeof coverFilter)}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-300"
              >
                <option value="all">All ({mediaCoverInfo.length})</option>
                <option value="with-cover">With Cover ({mediaCoverInfo.filter((c) => c.coverStatus !== "none").length})</option>
                <option value="without-cover">No Cover ({mediaCoverInfo.filter((c) => c.coverStatus === "none").length})</option>
                <option value="broken">Broken ({mediaCoverInfo.filter((c) => c.coverStatus === "broken-local").length})</option>
              </select>
            </div>
          </div>
          
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-800/95 backdrop-blur">
                  <tr className="border-b border-white/10">
                    <th className="text-left px-4 py-2 text-xs font-medium text-neutral-400">Cover</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-neutral-400">Title</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-neutral-400">Status</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-neutral-400">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredMedia.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                        No matching media items
                      </td>
                    </tr>
                  ) : (
                    filteredMedia.map((item) => (
                      <tr key={item.relPath} className="hover:bg-white/5 transition">
                        <td className="px-4 py-2">
                          <div className="w-10 h-14 rounded overflow-hidden bg-neutral-800 flex-shrink-0">
                            {item.resolvedUrl ? (
                              <img
                                src={item.resolvedUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <p className="font-medium text-neutral-200 truncate max-w-xs" title={item.title}>
                            {item.title}
                          </p>
                          <p className="text-xs text-neutral-500 truncate max-w-xs" title={item.relPath}>
                            {item.relPath}
                          </p>
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={item.coverStatus} />
                        </td>
                        <td className="px-4 py-2">
                          {item.coverValue && (
                            <p className="text-xs text-neutral-400 truncate max-w-[150px]" title={item.coverValue}>
                              {item.coverValue}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Broken Links Warning */}
          {healthStats && healthStats.brokenLocalCovers > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium text-red-200">
                  {healthStats.brokenLocalCovers} broken cover link{healthStats.brokenLocalCovers !== 1 ? "s" : ""}
                </p>
              </div>
              <p className="text-xs text-red-300/70">
                These media items reference local covers that don&apos;t exist. Update the metadata to fix.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Folder Browser Modal */}
      {showBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowBrowser(false); }}
        >
          <div className="w-full max-w-xl rounded-md border border-white/15 bg-neutral-900 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">Select Covers Folder</h3>
                <p className="text-xs text-neutral-400 mt-0.5 font-mono truncate max-w-md">
                  {browserPath || "Select a location"}
                </p>
              </div>
              <button onClick={() => setShowBrowser(false)} className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "neutral",
}: {
  label: string;
  value: number;
  color?: "neutral" | "emerald" | "amber" | "red" | "blue" | "purple";
}) {
  const colorClasses = {
    neutral: "text-neutral-200",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-red-300",
    blue: "text-blue-300",
    purple: "text-purple-300",
  };
  
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: CoverStatus }) {
  const config = {
    none: { label: "No Cover", bg: "bg-neutral-500/20", text: "text-neutral-400" },
    local: { label: "Local", bg: "bg-emerald-500/20", text: "text-emerald-300" },
    url: { label: "URL", bg: "bg-purple-500/20", text: "text-purple-300" },
    "broken-local": { label: "Broken", bg: "bg-red-500/20", text: "text-red-300" },
  };
  
  const { label, bg, text } = config[status];
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}
