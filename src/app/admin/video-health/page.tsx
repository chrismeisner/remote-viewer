"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  type MediaSource,
} from "@/constants/media";

type FaststartResult = {
  file: string;
  hasFaststart: boolean | null;
  moovPosition: "start" | "end" | "unknown";
  error?: string;
  fileSize?: number;
};

type FaststartResponse = {
  success: boolean;
  source: MediaSource;
  results: FaststartResult[];
  summary: {
    total: number;
    faststart: number;
    needsOptimization: number;
    unknown: number;
  };
  error?: string;
};

function formatFileSize(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function StatusBadge({ result }: { result: FaststartResult }) {
  if (result.error) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-200">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Error
      </span>
    );
  }
  
  if (result.hasFaststart === true) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Optimized
      </span>
    );
  }
  
  if (result.hasFaststart === false) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Needs Optimization
      </span>
    );
  }
  
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-400/30 bg-neutral-500/20 px-2 py-0.5 text-xs font-medium text-neutral-300">
      <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" />
      Unknown
    </span>
  );
}

export default function VideoHealthPage() {
  const [data, setData] = useState<FaststartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);
  const [filter, setFilter] = useState<"all" | "needs" | "good" | "unknown">("all");

  // Sync media source from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      setMediaSource(stored === "local" ? "local" : "remote");
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(MEDIA_SOURCE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(MEDIA_SOURCE_EVENT, sync);
    };
  }, []);

  const runCheck = useCallback(async () => {
    if (!mediaSource) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/media-index/faststart?source=${mediaSource}`, {
        cache: "no-store",
      });
      const result = await res.json();
      setData(result);
    } catch (error) {
      setData({
        success: false,
        source: mediaSource,
        results: [],
        summary: { total: 0, faststart: 0, needsOptimization: 0, unknown: 0 },
        error: error instanceof Error ? error.message : "Failed to check files",
      });
    } finally {
      setLoading(false);
    }
  }, [mediaSource]);

  useEffect(() => {
    if (mediaSource) {
      void runCheck();
    }
  }, [mediaSource, runCheck]);

  // Filter results based on selection
  const filteredResults = data?.results.filter(r => {
    if (filter === "all") return true;
    if (filter === "needs") return r.hasFaststart === false;
    if (filter === "good") return r.hasFaststart === true;
    if (filter === "unknown") return r.hasFaststart === null;
    return true;
  }) ?? [];

  const isRemote = mediaSource === "remote";

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">Video Health</h1>
          <p className="text-sm text-neutral-400">
            Check video files for streaming optimization (faststart)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {mediaSource && (
            <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isRemote ? "bg-blue-500/20 text-blue-200" : "bg-emerald-500/20 text-emerald-200"
            }`}>
              {isRemote ? "Remote" : "Local"}
            </div>
          )}
          <button
            onClick={() => void runCheck()}
            disabled={loading}
            className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Re-check"}
          </button>
        </div>
      </div>

      {/* Explanation Card */}
      <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-4">
        <p className="text-sm font-medium text-blue-100 mb-2">What is Faststart?</p>
        <p className="text-xs text-blue-200/80 leading-relaxed">
          MP4 files contain a &quot;moov&quot; atom with metadata about where video frames are located. 
          If this metadata is at the <strong>end</strong> of the file, browsers must download it first before 
          they can seek to a specific position—causing delays when joining mid-stream.
        </p>
        <p className="text-xs text-blue-200/80 leading-relaxed mt-2">
          <strong>Faststart</strong> moves the moov atom to the <strong>beginning</strong>, enabling instant seeking.
          Files marked &quot;Needs Optimization&quot; will have slower load times when viewers join mid-playback.
        </p>
      </div>

      {/* Error Message */}
      {data?.error && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-200">{data.error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {data && data.summary.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-md border p-4 text-left transition ${
              filter === "all" 
                ? "border-white/30 bg-white/10" 
                : "border-white/10 bg-neutral-900/60 hover:border-white/20"
            }`}
          >
            <p className="text-xs text-neutral-400 mb-1">Total Files</p>
            <p className="text-2xl font-bold text-neutral-50">{data.summary.total}</p>
          </button>
          <button
            onClick={() => setFilter("good")}
            className={`rounded-md border p-4 text-left transition ${
              filter === "good" 
                ? "border-emerald-400/50 bg-emerald-500/20" 
                : "border-emerald-400/20 bg-emerald-500/10 hover:border-emerald-400/30"
            }`}
          >
            <p className="text-xs text-emerald-300 mb-1">Optimized</p>
            <p className="text-2xl font-bold text-emerald-100">{data.summary.faststart}</p>
          </button>
          <button
            onClick={() => setFilter("needs")}
            className={`rounded-md border p-4 text-left transition ${
              filter === "needs" 
                ? "border-amber-400/50 bg-amber-500/20" 
                : "border-amber-400/20 bg-amber-500/10 hover:border-amber-400/30"
            }`}
          >
            <p className="text-xs text-amber-300 mb-1">Needs Optimization</p>
            <p className="text-2xl font-bold text-amber-100">{data.summary.needsOptimization}</p>
          </button>
          <button
            onClick={() => setFilter("unknown")}
            className={`rounded-md border p-4 text-left transition ${
              filter === "unknown" 
                ? "border-neutral-400/50 bg-neutral-500/20" 
                : "border-neutral-400/20 bg-neutral-500/10 hover:border-neutral-400/30"
            }`}
          >
            <p className="text-xs text-neutral-400 mb-1">Unknown</p>
            <p className="text-2xl font-bold text-neutral-300">{data.summary.unknown}</p>
          </button>
        </div>
      )}

      {/* How to Fix */}
      {data && data.summary.needsOptimization > 0 && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <h2 className="text-sm font-semibold text-neutral-100 mb-2">How to Fix</h2>
          <p className="text-xs text-neutral-400 mb-3">
            Re-mux files with faststart using ffmpeg. This is fast and doesn&apos;t re-encode the video:
          </p>
          <div className="rounded-lg bg-black/40 p-3 font-mono text-xs text-emerald-300 overflow-x-auto">
            ffmpeg -i input.mp4 -c copy -movflags +faststart output.mp4
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            Then replace the original file with the optimized version and re-upload to your CDN.
          </p>
        </div>
      )}

      {/* Results Table */}
      {data && filteredResults.length > 0 && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 shadow-lg shadow-black/30 overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <h2 className="text-sm font-semibold text-neutral-100">
              {filter === "all" ? "All Files" : 
               filter === "needs" ? "Files Needing Optimization" :
               filter === "good" ? "Optimized Files" : "Unknown Status"}
              <span className="ml-2 text-neutral-500">({filteredResults.length})</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-neutral-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">File</th>
                  <th className="px-4 py-3 text-left font-semibold">Size</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">moov Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredResults.map((result, idx) => (
                  <tr key={idx} className="bg-neutral-950/50 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <code className="text-xs text-neutral-300 break-all">{result.file}</code>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400 whitespace-nowrap">
                      {formatFileSize(result.fileSize)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge result={result} />
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {result.moovPosition === "start" && (
                        <span className="text-emerald-400">Beginning ✓</span>
                      )}
                      {result.moovPosition === "end" && (
                        <span className="text-amber-400">End (slow seeking)</span>
                      )}
                      {result.moovPosition === "unknown" && (
                        <span className="text-neutral-500">
                          {result.error || "Could not determine"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && !data && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-8 text-center">
          <div className="inline-block h-8 w-8 border-2 border-neutral-400 border-t-emerald-400 rounded-full animate-spin mb-3" />
          <p className="text-sm text-neutral-400">Checking video files…</p>
          <p className="text-xs text-neutral-500 mt-1">This may take a moment for large libraries</p>
        </div>
      )}

      {/* No Files State */}
      {data && data.summary.total === 0 && !data.error && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-8 text-center">
          <p className="text-neutral-400">No MP4/M4V/MOV files found in media index.</p>
        </div>
      )}

      {/* All Good State */}
      {data && data.summary.total > 0 && data.summary.needsOptimization === 0 && data.summary.unknown === 0 && (
        <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 p-8 text-center">
          <div className="text-4xl mb-3">✓</div>
          <h3 className="text-lg font-semibold text-emerald-100 mb-1">All Files Optimized!</h3>
          <p className="text-sm text-emerald-200/70">
            All {data.summary.total} video files have faststart enabled for optimal streaming.
          </p>
        </div>
      )}
    </div>
  );
}
