"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";
import { cleanupFilename } from "@/lib/filename-utils";
import MediaDetailModal from "@/components/MediaDetailModal";
import {
  type MediaFile,
  type MediaMetadata,
  type TargetResolution,
  formatDuration,
  formatDateTime,
  formatDateAdded,
  isBrowserSupported,
  hasUnsupportedAudio,
  buildConvertCommand,
  computeMediaHealth,
  parseFrameRate,
  needsSyncFix,
} from "@/lib/media-utils";

type FileResult = {
  file: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  probeSuccess: boolean;
  probeError?: string;
  wasReprobed?: boolean;
  wasCached?: boolean;
};

type ScanStats = {
  total: number;
  withDuration: number;
  zeroDuration: number;
  probeSuccessCount: number;
  probeFailCount: number;
  reprobedCount: number;
  fixedCount: number;
  cachedCount: number;
  // Incremental scan stats
  unchangedCount?: number;
  newOrChangedCount?: number;
  skippedFailureCount?: number;
};

type ScanReport = {
  fileResults: FileResult[];
  stats: ScanStats;
  message: string;
};

type ScanProgress = {
  phase: "loading-cache" | "connecting" | "listing" | "probing" | "uploading" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
  probing?: number;
  probeTotal?: number;
  currentFile?: string;
};

/* ─────────────────────────────────────────────────────────────────────────────
   Scan Progress Modal Component (blocks UI during scan)
   ───────────────────────────────────────────────────────────────────────────── */
function ScanProgressModal({ progress }: { progress: ScanProgress }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const phaseLabels: Record<ScanProgress["phase"], string> = {
    "loading-cache": "Loading Cache",
    connecting: "Connecting",
    listing: "Listing Files",
    probing: "Analyzing Files",
    uploading: "Uploading Index",
    complete: "Complete",
    error: "Error",
  };

  const phaseOrder: ScanProgress["phase"][] = [
    "loading-cache",
    "connecting",
    "listing",
    "probing",
    "uploading",
  ];

  const currentIdx = phaseOrder.indexOf(progress.phase);

  const pct =
    progress.phase === "probing" && progress.total && progress.total > 0
      ? Math.round((progress.current! / progress.total) * 100)
      : undefined;

  const fmtElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl shadow-black/60">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <div>
            <h3 className="text-sm font-semibold text-white">Scanning Remote Media</h3>
            <p className="text-xs text-neutral-400">
              Elapsed: {fmtElapsed(elapsed)}
            </p>
          </div>
        </div>

        {/* Phase steps */}
        <div className="mb-5 space-y-1.5">
          {phaseOrder.map((p, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <div key={p} className="flex items-center gap-2 text-xs">
                {done ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                ) : active ? (
                  <span className="flex h-4 w-4 items-center justify-center">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                  </span>
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-neutral-600" />
                  </span>
                )}
                <span
                  className={
                    done
                      ? "text-green-400/70"
                      : active
                        ? "font-medium text-white"
                        : "text-neutral-500"
                  }
                >
                  {phaseLabels[p]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress bar (during probing phase) */}
        {progress.phase === "probing" && pct !== undefined && (
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-400">
              <span>{progress.current} / {progress.total} files</span>
              <span>{pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-700">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            {progress.probeTotal !== undefined && progress.probeTotal > 0 && (
              <p className="mt-1 text-[10px] text-neutral-500">
                {progress.probing} of {progress.probeTotal} files probed (rest cached)
              </p>
            )}
          </div>
        )}

        {/* Current status message */}
        <p className="text-xs text-neutral-300">{progress.message}</p>

        {/* Current file being processed */}
        {progress.currentFile && (
          <p className="mt-1 truncate text-[10px] text-neutral-500" title={progress.currentFile}>
            {progress.currentFile}
          </p>
        )}

        <p className="mt-4 text-center text-[10px] text-neutral-600">
          Please wait — do not navigate away
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Scan Report Modal Component
   ───────────────────────────────────────────────────────────────────────────── */
function ScanReportModal({
  report,
  onClose,
  onRecheck,
  onUpdateReport,
}: {
  report: ScanReport;
  onClose: () => void;
  onRecheck?: (relPath: string) => Promise<{ success: boolean; probeSuccess?: boolean; file?: FileResult; message?: string }>;
  onUpdateReport?: (updatedReport: ScanReport) => void;
}) {
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [recheckingFile, setRecheckingFile] = useState<string | null>(null);
  const { stats, fileResults, message } = report;
  
  // Separate files into categories
  const filesWithIssues = fileResults.filter(f => !f.probeSuccess || f.durationSeconds === 0);
  const filesFixed = fileResults.filter(f => f.wasReprobed && f.probeSuccess && f.durationSeconds > 0);
  const filesOk = fileResults.filter(f => f.probeSuccess && f.durationSeconds > 0);

  // Handle recheck button click
  const handleRecheck = async (relPath: string) => {
    if (!onRecheck || !onUpdateReport) return;
    
    setRecheckingFile(relPath);
    try {
      const result = await onRecheck(relPath);
      
      if (result.success && result.file) {
        // Update the fileResults with the new probe result
        const updatedFileResults = fileResults.map(f => {
          if (f.file === relPath) {
            return {
              ...f,
              durationSeconds: result.file!.durationSeconds,
              probeSuccess: result.file!.probeSuccess,
              probeError: result.file!.probeError,
              wasReprobed: true,
            };
          }
          return f;
        });
        
        // Recalculate stats
        const newStats = {
          ...stats,
          withDuration: updatedFileResults.filter(f => f.durationSeconds > 0).length,
          zeroDuration: updatedFileResults.filter(f => f.durationSeconds === 0).length,
          probeSuccessCount: updatedFileResults.filter(f => f.probeSuccess).length,
          probeFailCount: updatedFileResults.filter(f => !f.probeSuccess).length,
        };
        
        onUpdateReport({
          fileResults: updatedFileResults,
          stats: newStats,
          message: message,
        });
      }
    } catch (err) {
      console.error("Recheck failed:", err);
    } finally {
      setRecheckingFile(null);
    }
  };
  
  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);
  
  const formatDurationDisplay = (seconds: number): string => {
    if (seconds === 0) return "0m";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };
  
  const successRate = stats.total > 0 
    ? Math.round((stats.withDuration / stats.total) * 100)
    : 0;
  
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/60 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-neutral-800/50 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-neutral-50 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Scan Report
            </h2>
            <p className="text-xs text-neutral-400 mt-1">{message}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex-shrink-0 rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-neutral-100 transition"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Stats Summary */}
        <div className="p-5 border-b border-white/10 bg-neutral-800/30">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-neutral-50">{stats.total}</p>
              <p className="text-xs text-neutral-400">Total Files</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-400">{stats.withDuration}</p>
              <p className="text-xs text-neutral-400">With Duration</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${stats.zeroDuration > 0 ? 'text-amber-400' : 'text-neutral-500'}`}>
                {stats.zeroDuration}
              </p>
              <p className="text-xs text-neutral-400">Still Zero</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                {successRate}%
              </p>
              <p className="text-xs text-neutral-400">Success Rate</p>
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="mt-4">
            <div className="h-2 bg-neutral-700 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${successRate === 100 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-blue-500 to-blue-400'}`}
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>
          
          {/* Scan details */}
          <div className="mt-4 flex flex-wrap gap-3 justify-center text-xs">
            {stats.unchangedCount !== undefined && stats.unchangedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-neutral-500/20 text-neutral-300">
                {stats.unchangedCount} unchanged
              </span>
            )}
            {stats.skippedFailureCount !== undefined && stats.skippedFailureCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-300" title="Files with known probe issues - will retry in 24 hours">
                {stats.skippedFailureCount} skipped (known issues)
              </span>
            )}
            {stats.newOrChangedCount !== undefined && stats.newOrChangedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-300">
                {stats.newOrChangedCount} probed
              </span>
            )}
            {stats.fixedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300">
                {stats.fixedCount} fixed ✓
              </span>
            )}
          </div>
        </div>
        
        {/* File Lists */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Fixed files - celebrate these! */}
          {filesFixed.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-emerald-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Fixed This Scan ({filesFixed.length})
              </h3>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {filesFixed.map((file) => (
                  <div 
                    key={file.file} 
                    className="flex items-center gap-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
                  >
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-xs text-neutral-200 font-mono truncate flex-1" title={file.file}>
                      {file.file}
                    </p>
                    <span className="text-xs text-emerald-300">
                      {formatDurationDisplay(file.durationSeconds)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Files with issues */}
          {filesWithIssues.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-amber-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Still Need Attention ({filesWithIssues.length})
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {filesWithIssues.map((file) => (
                  <div 
                    key={file.file} 
                    className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-200 font-mono truncate" title={file.file}>
                        {file.file}
                      </p>
                      <p className="text-xs text-amber-300/80 mt-0.5">
                        {file.probeError || "Duration: 0m"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {onRecheck && (
                        <button
                          onClick={() => handleRecheck(file.file)}
                          disabled={recheckingFile !== null}
                          className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          title="Retry probing this file now"
                        >
                          {recheckingFile === file.file ? (
                            <>
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Checking...
                            </>
                          ) : (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Recheck
                            </>
                          )}
                        </button>
                      )}
                      <span className="text-xs px-2 py-1 rounded bg-neutral-700 text-neutral-300 uppercase">
                        {file.format}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Successfully scanned files */}
          {filesOk.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Successfully Scanned ({filesOk.length})
                </h3>
                <button
                  onClick={() => setShowAllFiles(!showAllFiles)}
                  className="text-xs text-neutral-400 hover:text-neutral-200 transition"
                >
                  {showAllFiles ? "Hide" : "Show all"}
                </button>
              </div>
              
              {showAllFiles && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {filesOk.map((file) => (
                    <div 
                      key={file.file} 
                      className="flex items-center gap-3 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10"
                    >
                      <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <p className="text-xs text-neutral-300 font-mono truncate flex-1" title={file.file}>
                        {file.file}
                      </p>
                      <span className="text-xs text-neutral-500">
                        {formatDurationDisplay(file.durationSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* All files OK message */}
          {filesWithIssues.length === 0 && filesOk.length > 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-emerald-300">All Files Scanned Successfully!</p>
              <p className="text-sm text-neutral-400 mt-1">
                All {stats.total} files have valid duration metadata.
              </p>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="border-t border-white/10 bg-neutral-800/50 px-5 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-blue-500 hover:bg-blue-400 px-4 py-2.5 text-sm font-semibold text-white transition shadow-lg shadow-blue-500/20"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MediaAdminPage() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Start with null - wait for localStorage sync before loading data
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);
  const [mediaRefreshToken, setMediaRefreshToken] = useState(0);
  const [scanningRemote, setScanningRemote] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [hideUnsupported, setHideUnsupported] = useState(false);
  const [showSupported, setShowSupported] = useState(true);
  const [showScheduled, setShowScheduled] = useState(true);
  const [showSeries, setShowSeries] = useState(true);
  const [showNoCoverOnly, setShowNoCoverOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"filename" | "format" | "supported" | "scheduled" | "title" | "year" | "tags" | "duration" | "dateAdded">("filename");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [manifestUpdatedAt, setManifestUpdatedAt] = useState<string | null>(null);
  const [mediaRoot, setMediaRoot] = useState<string>("media");
  const [allMetadata, setAllMetadata] = useState<Record<string, MediaMetadata>>({});
  
  // Map of file relPath -> array of channel IDs where the file is scheduled
  const [fileChannelMap, setFileChannelMap] = useState<Map<string, string[]>>(new Map());
  
  // Bulk conversion command state
  const [selectedForConversion, setSelectedForConversion] = useState<Set<string>>(new Set());
  const [copiedBulkCommand, setCopiedBulkCommand] = useState(false);
  const [bulkTargetResolution, setBulkTargetResolution] = useState<TargetResolution>("original");

  // Filename hover tooltip state (fixed position to escape overflow containers)
  const [fnameTooltip, setFnameTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  // Bulk AI fill state
  const [bulkFillOpen, setBulkFillOpen] = useState(false);
  const [bulkFillRunning, setBulkFillRunning] = useState(false);
  const [bulkFillLookupMode, setBulkFillLookupMode] = useState<"entertainment" | "sports">("entertainment");
  const bulkFillAbortRef = useRef(false);
  const [bulkFillItems, setBulkFillItems] = useState<Array<{
    relPath: string;
    status: "pending" | "ai-lookup" | "imdb-lookup" | "saving" | "done" | "error" | "skipped";
    error?: string;
  }>>([]);

  // Load media source preference from localStorage and stay in sync with other tabs/pages.
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

  // Fetch the effective media root path for conversion commands
  useEffect(() => {
    fetch("/api/source")
      .then((res) => res.json())
      .then((data) => {
        if (data.effectiveMediaRoot) {
          setMediaRoot(data.effectiveMediaRoot);
        }
      })
      .catch(() => {
        // Keep default "media" if fetch fails
      });
  }, []);

  // Fetch all metadata for table display (works for both local and remote sources)
  useEffect(() => {
    // Wait for mediaSource to be synced from localStorage
    if (mediaSource === null) return;
    
    fetch(`/api/media-metadata?withAutoYear=true&source=${mediaSource}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.items) {
          setAllMetadata(data.items);
        }
      })
      .catch(() => {
        // Ignore errors, metadata is optional
      });
  }, [mediaRefreshToken, mediaSource]);

  // Fetch schedule data to build file->channels map
  useEffect(() => {
    // Wait for mediaSource to be synced from localStorage
    if (mediaSource === null) return;
    
    fetch(`/api/schedule?source=${encodeURIComponent(mediaSource)}&t=${Date.now()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const schedule = data.schedule;
        if (schedule?.channels) {
          const newMap = new Map<string, string[]>();
          
          for (const [chId, chSchedule] of Object.entries(schedule.channels) as [string, { slots?: { file: string }[]; playlist?: { file: string }[] }][]) {
            // Get files from slots (24hour type)
            if (chSchedule.slots) {
              for (const slot of chSchedule.slots) {
                if (slot.file) {
                  const existing = newMap.get(slot.file) || [];
                  if (!existing.includes(chId)) {
                    newMap.set(slot.file, [...existing, chId]);
                  }
                }
              }
            }
            // Get files from playlist (looping type)
            if (chSchedule.playlist) {
              for (const item of chSchedule.playlist) {
                if (item.file) {
                  const existing = newMap.get(item.file) || [];
                  if (!existing.includes(chId)) {
                    newMap.set(item.file, [...existing, chId]);
                  }
                }
              }
            }
          }
          
          setFileChannelMap(newMap);
        }
      })
      .catch(() => {
        // Ignore errors, schedule data is optional for display
      });
  }, [mediaRefreshToken, mediaSource]);

  // Toggle individual file selection for conversion
  const toggleFileSelection = (relPath: string) => {
    setSelectedForConversion((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(relPath)) {
        newSet.delete(relPath);
      } else {
        newSet.add(relPath);
      }
      return newSet;
    });
    setCopiedBulkCommand(false);
  };

  // Toggle all visible files
  const toggleAllVisible = () => {
    if (selectedForConversion.size === filteredFiles.length) {
      // All are selected, deselect all
      setSelectedForConversion(new Set());
    } else {
      // Select all visible
      setSelectedForConversion(new Set(filteredFiles.map((f) => f.relPath)));
    }
    setCopiedBulkCommand(false);
  };

  // Build and copy bulk conversion command
  const copyBulkConversionCommand = () => {
    const selectedFiles = filteredFiles.filter((f) => selectedForConversion.has(f.relPath));
    if (selectedFiles.length === 0) return;

    // Build individual commands for each file with the target resolution
    const commands = selectedFiles.map((file) => buildConvertCommand(file, mediaRoot, bulkTargetResolution));

    // Join with && to run sequentially (stops on error)
    const bulkCommand = commands.join(" && ");

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(bulkCommand)
        .then(() => setCopiedBulkCommand(true))
        .catch(() => setCopiedBulkCommand(false));
    } else {
      setCopiedBulkCommand(false);
      window.prompt("Copy this bulk command", bulkCommand);
    }
  };

  // Bulk AI fill: run AI lookup + auto-save for each selected file
  const handleBulkFill = async () => {
    const selectedFiles = filteredFiles.filter((f) => selectedForConversion.has(f.relPath));
    if (selectedFiles.length === 0) return;

    // Initialize items list
    const items = selectedFiles.map((f) => ({
      relPath: f.relPath,
      status: "pending" as const,
    }));
    setBulkFillItems(items);
    setBulkFillOpen(true);
    setBulkFillRunning(true);
    bulkFillAbortRef.current = false;

    for (let i = 0; i < selectedFiles.length; i++) {
      if (bulkFillAbortRef.current) break;

      const file = selectedFiles[i];

      // Update status to ai-lookup
      setBulkFillItems((prev) =>
        prev.map((item, idx) =>
          idx === i ? { ...item, status: "ai-lookup" } : item,
        ),
      );

      try {
        // Gather existing metadata as context for AI
        const existingMeta = allMetadata[file.relPath] || {};
        const existingMetadata: Record<string, unknown> = {};
        if (existingMeta.title) existingMetadata.title = existingMeta.title;
        if (existingMeta.year) existingMetadata.year = existingMeta.year;
        if (existingMeta.releaseDate) existingMetadata.releaseDate = existingMeta.releaseDate;
        if (existingMeta.director) existingMetadata.director = existingMeta.director;
        if (existingMeta.category) existingMetadata.category = existingMeta.category;
        if (existingMeta.makingOf) existingMetadata.makingOf = existingMeta.makingOf;
        if (existingMeta.plot) existingMetadata.plot = existingMeta.plot;
        if (existingMeta.type) existingMetadata.type = existingMeta.type;
        if (existingMeta.season) existingMetadata.season = existingMeta.season;
        if (existingMeta.episode) existingMetadata.episode = existingMeta.episode;
        if (existingMeta.imdbUrl) existingMetadata.imdbUrl = existingMeta.imdbUrl;
        if (existingMeta.eventUrl) existingMetadata.eventUrl = existingMeta.eventUrl;

        // Call AI lookup (balanced: 512 tokens)
        const isBulkSports = bulkFillLookupMode === "sports";
        const aiRes = await fetch("/api/media-metadata/ai-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.relPath,
            existingMetadata:
              Object.keys(existingMetadata).length > 0
                ? existingMetadata
                : undefined,
            maxTokens: 512,
            lookupMode: bulkFillLookupMode,
          }),
        });

        if (!aiRes.ok) {
          const errData = await aiRes.json();
          throw new Error(errData.error || "AI lookup failed");
        }

        const aiData = await aiRes.json();

        if (bulkFillAbortRef.current) break;

        // --- IMDB URL lookup (if AI didn't return one) ---
        // Skip IMDB search in sports mode — sports content uses eventUrl instead
        let finalImdbUrl: string | null = aiData.imdbUrl || null;

        const searchTitle = aiData.title || existingMeta.title;
        if (!isBulkSports && searchTitle && !finalImdbUrl) {
          setBulkFillItems((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: "imdb-lookup" } : item,
            ),
          );
          try {
            const imdbRes = await fetch("/api/media-metadata/imdb-search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filename: file.relPath.split("/").pop() || file.relPath,
                title: searchTitle,
                year: aiData.year || existingMeta.year || undefined,
                type: aiData.type || existingMeta.type || undefined,
                director: aiData.director || existingMeta.director || undefined,
                category: aiData.category || existingMeta.category || undefined,
                season: aiData.season || existingMeta.season || undefined,
                episode: aiData.episode || existingMeta.episode || undefined,
              }),
            });
            if (imdbRes.ok) {
              const imdbData = await imdbRes.json();
              if (imdbData.candidates?.length > 0) {
                finalImdbUrl = imdbData.candidates[0].imdbUrl;
              }
            }
          } catch {
            // IMDB search is best-effort — don't block the fill
          }
        }

        // --- Event URL search for sports content ---
        let finalEventUrl: string | null = aiData.eventUrl || null;
        if (isBulkSports && aiData.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(aiData.releaseDate)) {
          try {
            const bulkTitle = aiData.title || "";
            const bulkTitleParts = bulkTitle.split(/\s+(?:vs\.?|@|at|versus)\s+/i);
            const eventRes = await fetch("/api/media-metadata/event-search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sport: aiData.category || "Basketball",
                date: aiData.releaseDate,
                team1: bulkTitleParts[0]?.trim() || undefined,
                team2: bulkTitleParts[1]?.trim() || undefined,
              }),
            });
            if (eventRes.ok) {
              const eventData = await eventRes.json();
              if (eventData.bestMatch?.boxScoreUrl) {
                finalEventUrl = eventData.bestMatch.boxScoreUrl;
              }
            }
          } catch {
            // Event search is best-effort
          }
        }

        if (bulkFillAbortRef.current) break;

        // --- Fetch IMDB cover image if we have an IMDB URL ---
        // Skip IMDB cover fetch in sports mode
        let coverUrl: string | null = null;

        // For TV content, prefer the series poster (portrait format, better as cover art)
        // Fall back to episode still if series poster is not available
        const bulkSeriesImdbUrl = aiData.seriesImdbUrl || null;
        if (!isBulkSports && bulkSeriesImdbUrl && aiData.type === "tv") {
          const seriesIdMatch = bulkSeriesImdbUrl.match(/\/title\/(tt\d{7,8})/);
          if (seriesIdMatch) {
            try {
              const seriesRes = await fetch(
                `/api/media-metadata/imdb-preview?id=${seriesIdMatch[1]}`,
              );
              if (seriesRes.ok) {
                const seriesData = await seriesRes.json();
                const seriesImage = seriesData.image ?? null;
                if (seriesImage) {
                  coverUrl = seriesImage;
                }
              }
            } catch {
              // Series cover fetch is best-effort
            }
          }
        }

        // Fall back to the episode/title image if no series poster found
        if (!isBulkSports && !coverUrl && finalImdbUrl) {
          const imdbIdMatch = finalImdbUrl.match(/\/title\/(tt\d{7,8})/);
          if (imdbIdMatch) {
            try {
              const previewRes = await fetch(
                `/api/media-metadata/imdb-preview?id=${imdbIdMatch[1]}`,
              );
              if (previewRes.ok) {
                const previewData = await previewRes.json();
                const image = previewData.image ?? null;
                if (image) {
                  coverUrl = image;
                }
              }
            } catch {
              // Cover fetch is best-effort
            }
          }
        }

        if (bulkFillAbortRef.current) break;

        // Update status to saving
        setBulkFillItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: "saving" } : item,
          ),
        );

        // Build save payload from AI response + IMDB data
        const payload: Record<string, unknown> = {
          file: file.relPath,
          source: mediaSource,
          title: aiData.title || null,
          year: aiData.year || null,
          releaseDate: aiData.releaseDate || null,
          director: aiData.director || null,
          category: aiData.category || null,
          makingOf: aiData.makingOf || null,
          plot: aiData.plot || null,
          type: aiData.type || null,
          season: aiData.season || null,
          episode: aiData.episode || null,
          imdbUrl: finalImdbUrl,
          eventUrl: finalEventUrl,
        };

        // Include cover image from IMDB if found
        if (coverUrl) {
          payload.coverUrl = coverUrl;
          payload.coverEmoji = null;
        }

        const saveRes = await fetch("/api/media-metadata", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!saveRes.ok) {
          const errData = await saveRes.json();
          throw new Error(errData.error || "Save failed");
        }

        const saveData = await saveRes.json();

        // Update local metadata state so the table reflects changes
        setAllMetadata((prev) => ({
          ...prev,
          [file.relPath]: saveData.metadata,
        }));

        // Mark as done
        setBulkFillItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: "done" } : item,
          ),
        );
      } catch (err) {
        setBulkFillItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                  ...item,
                  status: "error",
                  error:
                    err instanceof Error ? err.message : "Unknown error",
                }
              : item,
          ),
        );
      }
    }

    // Mark remaining items as skipped if aborted
    if (bulkFillAbortRef.current) {
      setBulkFillItems((prev) =>
        prev.map((item) =>
          item.status === "pending"
            ? { ...item, status: "skipped" }
            : item,
        ),
      );
    }

    setBulkFillRunning(false);
  };

  // Load available media list
  useEffect(() => {
    // Wait for mediaSource to be synced from localStorage
    if (mediaSource === null) return;

    let cancelled = false;
    setFiles([]);
    setLoading(true);
    setMessage(null);
    setError(null);
    setManifestUpdatedAt(null);

    const load = async () => {
      try {
        let filesJson: { items?: MediaFile[]; generatedAt?: string } = {};
        let generatedAt: string | null = null;
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
            generatedAt = filesJson.generatedAt ?? null;
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
          setManifestUpdatedAt(generatedAt);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load media files");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [mediaSource, mediaRefreshToken]);

  // Handler for clicking column headers to sort
  const handleColumnSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      // Toggle direction if clicking same column
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      // Set new column with default direction
      setSortBy(column);
      setSortDirection("asc");
    }
  };

  const sortedFiles = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...files].sort((a, b) => {
      const metaA = allMetadata[a.relPath] || {};
      const metaB = allMetadata[b.relPath] || {};

      let result = 0;
      switch (sortBy) {
        case "filename":
          result = a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" });
          break;
        
        case "format": {
          const extA = a.relPath.split(".").pop()?.toLowerCase() || "";
          const extB = b.relPath.split(".").pop()?.toLowerCase() || "";
          result = extA.localeCompare(extB, undefined, { sensitivity: "base" });
          break;
        }
        
        case "supported": {
          const suppA = isBrowserSupported(a) ? 1 : 0;
          const suppB = isBrowserSupported(b) ? 1 : 0;
          result = suppA - suppB;
          break;
        }
        
        case "scheduled": {
          const schedA = fileChannelMap.has(a.relPath) ? 1 : 0;
          const schedB = fileChannelMap.has(b.relPath) ? 1 : 0;
          result = schedA - schedB;
          break;
        }
        
        case "title": {
          const hasA = !!metaA.title;
          const hasB = !!metaB.title;
          // Push items without title to bottom
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          const titleA = metaA.title || a.relPath;
          const titleB = metaB.title || b.relPath;
          result = titleA.localeCompare(titleB, undefined, { sensitivity: "base" });
          break;
        }
        
        case "year": {
          const hasA = !!metaA.year;
          const hasB = !!metaB.year;
          // Push items without year to bottom
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          if (!hasA && !hasB) return 0;
          result = (metaA.year || 0) - (metaB.year || 0);
          break;
        }
        
        case "tags": {
          const tagsA = metaA.tags || [];
          const tagsB = metaB.tags || [];
          const hasA = tagsA.length > 0;
          const hasB = tagsB.length > 0;
          // Push items without tags to bottom
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          if (!hasA && !hasB) return 0;
          // Sort by first tag alphabetically, then by tag count
          const firstTagCompare = (tagsA[0] || "").localeCompare(tagsB[0] || "", undefined, { sensitivity: "base" });
          result = firstTagCompare !== 0 ? firstTagCompare : tagsA.length - tagsB.length;
          break;
        }
        
        case "duration": {
          const hasA = a.durationSeconds > 0;
          const hasB = b.durationSeconds > 0;
          // Push items without duration to bottom
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          if (!hasA && !hasB) return 0;
          result = a.durationSeconds - b.durationSeconds;
          break;
        }
        
        case "dateAdded": {
          const dateA = metaA.dateAdded || a.dateAdded || "";
          const dateB = metaB.dateAdded || b.dateAdded || "";
          const hasA = !!dateA;
          const hasB = !!dateB;
          // Push items without date to bottom
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          if (!hasA && !hasB) return 0;
          result = dateA.localeCompare(dateB);
          break;
        }
        
        default:
          result = a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" });
      }
      return result * direction;
    });
  }, [files, sortBy, sortDirection, allMetadata, fileChannelMap]);

  const filteredFiles = useMemo(() => {
    const terms = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return sortedFiles.filter((file) => {
      // Support filters
      const browserSupported = isBrowserSupported(file);
      if (hideUnsupported && !browserSupported) return false;
      if (!showSupported && browserSupported) return false;
      // Series filter (files in folders are considered series)
      const isSeries = file.relPath.includes("/");
      if (!showSeries && isSeries) return false;
      // Scheduled filter
      const isScheduled = fileChannelMap.has(file.relPath);
      if (!showScheduled && isScheduled) return false;
      // Cover filter - show only items without covers when checkbox is checked
      if (showNoCoverOnly) {
        const meta = allMetadata[file.relPath] || {};
        const hasCover = !!(meta.coverUrl || meta.coverLocal || meta.coverPath || meta.coverEmoji);
        if (hasCover) return false;
      }
      // Search query - includes filename, title, and all metadata fields
      if (terms.length > 0) {
        const meta = allMetadata[file.relPath] || {};
        const tagsStr = meta.tags?.join(" ") || "";
        const haystack = [
          file.relPath,
          file.title || "",
          meta.title || "",
          meta.director || "",
          meta.category || "",
          meta.makingOf || "",
          meta.plot || "",
          meta.year?.toString() || "",
          meta.releaseDate || "",
          meta.type || "",
          meta.season?.toString() || "",
          meta.episode?.toString() || "",
          meta.imdbUrl || "",
          meta.eventUrl || "",
          tagsStr,
        ].join(" ").toLowerCase();
        if (!terms.every((term) => haystack.includes(term))) {
          return false;
        }
      }
      return true;
    });
  }, [sortedFiles, hideUnsupported, showSupported, showScheduled, showSeries, showNoCoverOnly, searchQuery, allMetadata, fileChannelMap]);

  const totalDurationSeconds = useMemo(
    () => sortedFiles.reduce((sum, f) => sum + (f.durationSeconds || 0), 0),
    [sortedFiles],
  );

  const refreshMediaList = () => {
    setMediaRefreshToken((token) => token + 1);
  };

  const scanRemoteMedia = async () => {
    setScanningRemote(true);
    setScanProgress({ phase: "loading-cache", message: "Starting scan…" });
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/media-index/scan-remote", { method: "POST" });

      if (!res.ok || !res.body) {
        const text = await res.text();
        let parsed: { message?: string } | undefined;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        throw new Error(parsed?.message || `Scan failed (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      type ScanResultData = {
        success?: boolean;
        message?: string;
        count?: number;
        fileResults?: FileResult[];
        stats?: ScanStats;
      };
      let finalData: ScanResultData | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          try {
            const evt = JSON.parse(json) as Record<string, unknown>;
            if (evt.phase === "complete") {
              finalData = evt.data as ScanResultData;
            } else if (evt.phase === "error") {
              throw new Error((evt.message as string) || "Scan failed");
            } else {
              setScanProgress(evt as unknown as ScanProgress);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message.startsWith("Scan failed")) throw parseErr;
          }
        }
      }

      setScanProgress(null);

      if (finalData?.fileResults && finalData.stats) {
        setScanReport({
          fileResults: finalData.fileResults,
          stats: finalData.stats,
          message: finalData.message || `Scanned ${finalData.count} files`,
        });
      } else if (finalData) {
        setMessage(finalData.message || `Scanned remote and found ${finalData.count} files`);
      } else {
        throw new Error("Scan completed without returning data");
      }

      refreshMediaList();
    } catch (err) {
      setScanProgress(null);
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanningRemote(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase text-neutral-300">
            Media Library
          </p>
          <p className="text-sm text-neutral-400">
            Single source of truth for all media files based on current source settings ({mediaSource === null ? "Loading…" : mediaSource === "remote" ? "Remote CDN" : "Local files"}).
          </p>
          {manifestUpdatedAt && (
            <p className="text-xs text-neutral-500 mt-1">
              Media index JSON updated {formatDateTime(manifestUpdatedAt)}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold flex-shrink-0 ${
            mediaSource === null
              ? "bg-neutral-500/20 text-neutral-200"
              : mediaSource === "remote"
                ? "bg-blue-500/20 text-blue-200"
                : "bg-emerald-500/20 text-emerald-200"
          }`}
        >
          {mediaSource === null ? "…" : mediaSource === "remote" ? "Remote" : "Local"}
        </span>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Total Files</p>
          <p className="text-2xl font-semibold text-neutral-50">{sortedFiles.length}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Supported</p>
          <p className="text-2xl font-semibold text-emerald-300">
            {sortedFiles.filter((f) => isBrowserSupported(f)).length}
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Total Duration</p>
          <p className="text-2xl font-semibold text-neutral-50">
            {formatDuration(totalDurationSeconds)}
          </p>
        </div>
      </div>

      {/* Media Table */}
      <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-neutral-100">
              Available Media
            </h3>
            <span className="text-xs text-neutral-400">
              {filteredFiles.length} file{filteredFiles.length === 1 ? "" : "s"}
              {filteredFiles.length !== sortedFiles.length &&
                ` (of ${sortedFiles.length} total)`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshMediaList}
              disabled={loading}
              className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              title="Refresh the media library"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {mediaSource === "remote" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void scanRemoteMedia()}
                  disabled={loading || scanningRemote}
                  className="rounded-md border border-blue-300/50 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                  title="Scan remote FTP folder, analyze all media files, and update the remote media-index.json"
                >
                  {scanningRemote ? "Syncing…" : "Scan & Sync Remote"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bulk Conversion Command Button */}
        {selectedForConversion.size > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-emerald-200">
                {selectedForConversion.size} file{selectedForConversion.size === 1 ? "" : "s"} selected
              </span>
              
              {/* Resolution selector for bulk operations */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">Output:</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setBulkTargetResolution("original");
                      setCopiedBulkCommand(false);
                    }}
                    className={`px-2.5 py-1 text-xs rounded-md transition ${
                      bulkTargetResolution === "original"
                        ? "bg-blue-500/30 text-blue-100 border border-blue-400/50"
                        : "bg-white/5 text-neutral-400 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    Keep Original
                  </button>
                  <button
                    onClick={() => {
                      setBulkTargetResolution("720");
                      setCopiedBulkCommand(false);
                    }}
                    className={`px-2.5 py-1 text-xs rounded-md transition ${
                      bulkTargetResolution === "720"
                        ? "bg-emerald-500/30 text-emerald-100 border border-emerald-400/50"
                        : "bg-white/5 text-neutral-400 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    720p (smaller)
                  </button>
                </div>
              </div>
              
              <button
                onClick={copyBulkConversionCommand}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30"
              >
                {copiedBulkCommand ? "Copied!" : "Copy conversion command"}
              </button>
              <div className="inline-flex rounded-md border border-white/15 overflow-hidden" role="group">
                <button
                  type="button"
                  onClick={() => setBulkFillLookupMode("entertainment")}
                  className={`px-2.5 py-2 text-xs font-medium transition ${
                    bulkFillLookupMode === "entertainment"
                      ? "bg-amber-500/20 text-amber-300 border-r border-white/15"
                      : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-neutral-300 border-r border-white/15"
                  }`}
                >
                  Film / TV
                </button>
                <button
                  type="button"
                  onClick={() => setBulkFillLookupMode("sports")}
                  className={`px-2.5 py-2 text-xs font-medium transition ${
                    bulkFillLookupMode === "sports"
                      ? "bg-sky-500/20 text-sky-300"
                      : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-neutral-300"
                  }`}
                >
                  Sporting Event
                </button>
              </div>
              <button
                onClick={handleBulkFill}
                className="rounded-md border border-blue-300/50 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30"
              >
                Fill Meta
              </button>
            </div>
            <button
              onClick={() => {
                setSelectedForConversion(new Set());
                setCopiedBulkCommand(false);
              }}
              className="text-xs text-neutral-400 hover:text-neutral-200 transition"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Filters and Search */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search all metadata (title, tags, plot, type, etc.)"
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hideUnsupported}
              onChange={(e) => setHideUnsupported(e.target.checked)}
              className="w-4 h-4 rounded border-white/15 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
            />
            <span className="text-xs text-neutral-400">Hide Unsupported</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showScheduled}
              onChange={(e) => setShowScheduled(e.target.checked)}
              className="w-4 h-4 rounded border-white/15 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
            />
            <span className="text-xs text-neutral-400">Show Scheduled</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSeries}
              onChange={(e) => setShowSeries(e.target.checked)}
              className="w-4 h-4 rounded border-white/15 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
            />
            <span className="text-xs text-neutral-400">Show Series</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showNoCoverOnly}
              onChange={(e) => setShowNoCoverOnly(e.target.checked)}
              className="w-4 h-4 rounded border-white/15 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
            />
            <span className="text-xs text-neutral-400">No Cover</span>
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-300">Loading…</p>
        ) : (
          <>
            {sortedFiles.length === 0 ? (
              <p className="text-sm text-neutral-300">
                No media found in your library. Add files to your media folder.
              </p>
            ) : filteredFiles.length === 0 ? (
              <p className="text-sm text-neutral-300">
                No media files match the current filters.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/5">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-white/5 text-neutral-200">
                    <tr>
                      <th className="px-3 py-2 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={selectedForConversion.size === filteredFiles.length && filteredFiles.length > 0}
                          onChange={toggleAllVisible}
                          className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                          title="Select/deselect all visible files"
                        />
                      </th>
                      <th className="px-3 py-2 font-semibold w-16 text-center">Cover</th>
                      <th 
                        className="px-3 py-2 font-semibold min-w-[150px] cursor-pointer hover:bg-white/5 transition select-none"
                        onClick={() => handleColumnSort("title")}
                      >
                        <span className="flex items-center gap-1">
                          Title
                          {sortBy === "title" && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {sortDirection === "asc" ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                      <th 
                        className="px-3 py-2 font-semibold w-64 cursor-pointer hover:bg-white/5 transition select-none"
                        onClick={() => handleColumnSort("filename")}
                      >
                        <span className="flex items-center gap-1">
                          File
                          {sortBy === "filename" && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {sortDirection === "asc" ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                      <th 
                        className="px-3 py-2 font-semibold w-16 text-center cursor-pointer hover:bg-white/5 transition select-none"
                        onClick={() => handleColumnSort("year")}
                      >
                        <span className="flex items-center justify-center gap-1">
                          Year
                          {sortBy === "year" && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {sortDirection === "asc" ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                      <th 
                        className="px-3 py-2 font-semibold w-24 text-right cursor-pointer hover:bg-white/5 transition select-none"
                        onClick={() => handleColumnSort("duration")}
                      >
                        <span className="flex items-center justify-end gap-1">
                          Duration
                          {sortBy === "duration" && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {sortDirection === "asc" ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                      <th 
                        className="px-3 py-2 font-semibold w-28 text-left cursor-pointer hover:bg-white/5 transition select-none"
                        onClick={() => handleColumnSort("scheduled")}
                      >
                        <span className="flex items-center gap-1">
                          Scheduled
                          {sortBy === "scheduled" && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {sortDirection === "asc" ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                      <th 
                        className="px-3 py-2 font-semibold w-20 text-left cursor-pointer hover:bg-white/5 transition select-none"
                        onClick={() => handleColumnSort("format")}
                      >
                        <span className="flex items-center gap-1">
                          Format
                          {sortBy === "format" && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {sortDirection === "asc" ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                      <th 
                        className="px-3 py-2 font-semibold w-28 text-left cursor-pointer hover:bg-white/5 transition select-none"
                        onClick={() => handleColumnSort("supported")}
                      >
                        <span className="flex items-center gap-1">
                          Supported
                          {sortBy === "supported" && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {sortDirection === "asc" ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                      <th 
                        className="px-3 py-2 font-semibold w-28 text-left cursor-pointer hover:bg-white/5 transition select-none"
                        onClick={() => handleColumnSort("dateAdded")}
                      >
                        <span className="flex items-center gap-1">
                          Added
                          {sortBy === "dateAdded" && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {sortDirection === "asc" ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 bg-neutral-950/40 text-neutral-100">
                    {filteredFiles.map((file) => {
                      const meta = allMetadata[file.relPath] || {};
                      const isSelected = selectedForConversion.has(file.relPath);
                      // Resolve cover URL - for remote mode, coverLocal should point to remote server
                      const resolvedCoverUrl = meta.coverUrl 
                        || (meta.coverPath && mediaSource === "local" ? `/api/local-image?path=${encodeURIComponent(meta.coverPath)}` : null)
                        || (meta.coverLocal ? (mediaSource === "remote" ? `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(meta.coverLocal)}` : `/api/covers/${encodeURIComponent(meta.coverLocal)}`) : null);
                      // Check for emoji cover
                      const hasEmoji = !!meta.coverEmoji;
                      return (
                        <tr key={file.relPath} className={isSelected ? "bg-emerald-500/5" : ""}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleFileSelection(file.relPath)}
                              className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2">
                            {hasEmoji ? (
                              /* Emoji cover */
                              <button
                                type="button"
                                onClick={() => setSelectedFile(file)}
                                className="w-12 h-12 bg-gradient-to-br from-neutral-800 to-neutral-900 rounded border border-white/10 flex items-center justify-center text-2xl cursor-pointer hover:border-emerald-400/40 transition-colors"
                                title="Click to edit cover"
                              >
                                {meta.coverEmoji}
                              </button>
                            ) : resolvedCoverUrl ? (
                              <img 
                                src={resolvedCoverUrl} 
                                alt={meta.title || file.relPath}
                                className="w-12 h-12 object-cover rounded border border-white/10"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedFile(file)}
                                className="w-12 h-12 bg-white/5 rounded border border-white/10 flex items-center justify-center text-neutral-600 hover:text-neutral-400 hover:bg-white/10 text-xs transition-colors cursor-pointer"
                                title="Click to add cover"
                              >
                                —
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2 text-neutral-200">
                            {meta.title || <span className="text-neutral-500">—</span>}
                          </td>
                          <td className="px-3 py-2 max-w-[256px]">
                            <button
                              type="button"
                              className="text-left underline decoration-dotted underline-offset-2 hover:text-emerald-200 truncate block w-full"
                              onClick={() => setSelectedFile(file)}
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setFnameTooltip({ text: file.relPath, x: rect.left, y: rect.top });
                              }}
                              onMouseLeave={() => setFnameTooltip(null)}
                            >
                              {file.relPath}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-center text-neutral-200">
                            {meta.year || <span className="text-neutral-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-neutral-200">
                            {formatDuration(file.durationSeconds)}
                          </td>
                          <td className="px-3 py-2 text-left">
                            {(() => {
                              const scheduledChannels = fileChannelMap.get(file.relPath) || [];
                              if (scheduledChannels.length === 0) {
                                return <span className="text-xs text-neutral-500">—</span>;
                              }
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {scheduledChannels.map((ch) => (
                                    <span
                                      key={ch}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-500/30 text-purple-200 border border-purple-400/40"
                                      title={`Scheduled in channel ${ch}`}
                                    >
                                      {ch}
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-left text-neutral-200 uppercase">
                            {file.format || "—"}
                          </td>
                          <td className="px-3 py-2 text-left">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                isBrowserSupported(file)
                                  ? "bg-emerald-500/20 text-emerald-100"
                                  : "bg-amber-500/20 text-amber-100"
                              }`}
                            >
                              {isBrowserSupported(file)
                                ? file.supportedViaCompanion
                                  ? "Yes (companion)"
                                  : "Yes"
                                : hasUnsupportedAudio(file)
                                  ? "No (audio)"
                                  : "No"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-left text-neutral-400 text-xs">
                            {file.dateAdded ? formatDateAdded(file.dateAdded) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-amber-300">{error}</p>}

      {selectedFile && mediaSource && (
        <MediaDetailModal
          item={selectedFile}
          mediaSource={mediaSource}
          mediaRoot={mediaRoot}
          allFiles={files}
          onClose={() => setSelectedFile(null)}
          onMetadataUpdate={(relPath, metadata) => {
            setAllMetadata((prev) => ({
              ...prev,
              [relPath]: metadata,
            }));
          }}
          onFileRenamed={(oldPath, newPath) => {
            // Update the files list with the new path and title
            const newFileName = newPath.split("/").pop() || newPath;
            const newTitle = newFileName.replace(/\.[^/.]+$/, "");
            setFiles((prev) =>
              prev.map((f) =>
                f.relPath === oldPath 
                  ? { ...f, relPath: newPath, title: newTitle } 
                  : f
              )
            );
            // Update the selected file
            setSelectedFile((prev) =>
              prev && prev.relPath === oldPath 
                ? { ...prev, relPath: newPath, title: newTitle } 
                : prev
            );
            // Move metadata to new key
            setAllMetadata((prev) => {
              const updated = { ...prev };
              if (updated[oldPath]) {
                updated[newPath] = updated[oldPath];
                delete updated[oldPath];
              }
              return updated;
            });
            setMessage(`File renamed successfully`);
          }}
        />
      )}

      {/* Bulk AI Fill Progress Modal */}
      {bulkFillOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-xl border border-white/10 bg-neutral-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h2 className="text-lg font-semibold text-white">
                Bulk Fill Meta with AI
              </h2>
              {!bulkFillRunning && (
                <button
                  onClick={() => { setBulkFillOpen(false); setSelectedForConversion(new Set()); setCopiedBulkCommand(false); }}
                  className="text-neutral-400 hover:text-white transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>

            {/* Progress bar */}
            <div className="px-6 pt-4">
              {(() => {
                const done = bulkFillItems.filter((it) => it.status === "done").length;
                const errored = bulkFillItems.filter((it) => it.status === "error").length;
                const skipped = bulkFillItems.filter((it) => it.status === "skipped").length;
                const processed = done + errored + skipped;
                const total = bulkFillItems.length;
                const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

                return (
                  <div>
                    <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
                      <span>
                        {bulkFillRunning
                          ? `Processing ${processed + 1} of ${total}…`
                          : `Done — ${done} saved, ${errored} failed${skipped > 0 ? `, ${skipped} skipped` : ""}`}
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* File list */}
            <div className="px-6 py-4 max-h-80 overflow-y-auto">
              <ul className="space-y-1">
                {bulkFillItems.map((item) => {
                  const filename = item.relPath.split("/").pop() || item.relPath;
                  return (
                    <li
                      key={item.relPath}
                      className="flex items-center gap-2 text-sm py-1 border-b border-white/5 last:border-0"
                    >
                      {/* Status icon */}
                      <span className="flex-shrink-0 w-5 text-center">
                        {item.status === "pending" && (
                          <span className="text-neutral-500">○</span>
                        )}
                        {item.status === "ai-lookup" && (
                          <span className="text-blue-400 animate-pulse">●</span>
                        )}
                        {item.status === "imdb-lookup" && (
                          <span className="text-amber-400 animate-pulse">●</span>
                        )}
                        {item.status === "saving" && (
                          <span className="text-yellow-400 animate-pulse">●</span>
                        )}
                        {item.status === "done" && (
                          <span className="text-emerald-400">✓</span>
                        )}
                        {item.status === "error" && (
                          <span className="text-red-400">✗</span>
                        )}
                        {item.status === "skipped" && (
                          <span className="text-neutral-500">—</span>
                        )}
                      </span>

                      {/* Filename */}
                      <span
                        className={`truncate flex-1 ${
                          item.status === "done"
                            ? "text-emerald-300"
                            : item.status === "error"
                              ? "text-red-300"
                              : item.status === "ai-lookup" || item.status === "imdb-lookup" || item.status === "saving"
                                ? "text-white"
                                : "text-neutral-500"
                        }`}
                        title={item.relPath}
                      >
                        {filename}
                      </span>

                      {/* Status label */}
                      <span className="flex-shrink-0 text-xs text-neutral-500">
                        {item.status === "ai-lookup" && "AI lookup…"}
                        {item.status === "imdb-lookup" && "IMDB search…"}
                        {item.status === "saving" && "Saving…"}
                        {item.status === "done" && "Saved"}
                        {item.status === "error" && (
                          <span className="text-red-400" title={item.error}>
                            {item.error && item.error.length > 30
                              ? item.error.slice(0, 30) + "…"
                              : item.error || "Failed"}
                          </span>
                        )}
                        {item.status === "skipped" && "Skipped"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
              {bulkFillRunning ? (
                <button
                  onClick={() => {
                    bulkFillAbortRef.current = true;
                  }}
                  className="rounded-md border border-red-300/50 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-50 transition hover:border-red-200 hover:bg-red-500/30"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => { setBulkFillOpen(false); setSelectedForConversion(new Set()); setCopiedBulkCommand(false); }}
                  className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-neutral-200 transition hover:bg-white/20"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fixed-position filename tooltip (escapes table overflow) */}
      {fnameTooltip && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: fnameTooltip.x, top: fnameTooltip.y - 8, transform: "translateY(-100%)" }}
        >
          <div className="rounded-md border border-white/20 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 shadow-xl shadow-black/50 max-w-[500px] break-all whitespace-pre-wrap">
            {fnameTooltip.text}
          </div>
        </div>
      )}

      {scanProgress && (
        <ScanProgressModal progress={scanProgress} />
      )}

      {scanReport && (
        <ScanReportModal
          report={scanReport}
          onClose={() => setScanReport(null)}
          onRecheck={async (relPath) => {
            const res = await fetch("/api/media-index/recheck", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ relPath }),
            });
            const data = await res.json();
            if (data.success && data.probeSuccess) {
              // Refresh the media list since the index was updated
              refreshMediaList();
            }
            return {
              success: data.success,
              probeSuccess: data.probeSuccess,
              file: data.file,
              message: data.message,
            };
          }}
          onUpdateReport={(updatedReport) => setScanReport(updatedReport)}
        />
      )}
    </div>
  );
}

