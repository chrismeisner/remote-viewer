"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

type MediaFile = {
  relPath: string;
  title?: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
};

type FileResult = {
  file: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  probeSuccess: boolean;
  probeError?: string;
};

type ScanStats = {
  total: number;
  withDuration: number;
  zeroDuration: number;
  probeSuccessCount: number;
  probeFailCount: number;
};

type ScanReport = {
  fileResults: FileResult[];
  stats: ScanStats;
  message: string;
};

/* ─────────────────────────────────────────────────────────────────────────────
   Media Detail Modal Component
   ───────────────────────────────────────────────────────────────────────────── */
function MediaDetailModal({
  item,
  mediaSource,
  onClose,
}: {
  item: MediaFile;
  mediaSource: MediaSource;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.durationSeconds || 0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);

  // Build the video URL based on media source
  const videoUrl =
    mediaSource === "remote"
      ? `${REMOTE_MEDIA_BASE}${item.relPath}`
      : `/api/media?file=${encodeURIComponent(item.relPath)}`;

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Reset copied state when item changes
  useEffect(() => {
    setCopiedCommand(false);
  }, [item]);

  // Update time display
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  }, []);

  const handleError = useCallback(() => {
    setError("Failed to load video. The format may not be supported by your browser.");
    setIsLoading(false);
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const fileName = item.relPath.split("/").pop() || item.relPath;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-neutral-800/50 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-neutral-50 truncate" title={fileName}>
              {fileName}
            </h2>
            <p className="text-xs text-neutral-400 truncate font-mono" title={item.relPath}>
              {item.relPath}
            </p>
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

        {/* Video Player */}
        <div className="relative bg-black aspect-video">
          {isLoading && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-3 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
                <p className="text-sm text-neutral-400">Loading video...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/20 mb-4">
                  <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-sm text-amber-200 mb-2">Unable to preview</p>
                <p className="text-xs text-neutral-400 max-w-xs">{error}</p>
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            src={videoUrl}
            className={`w-full h-full object-contain ${isLoading || error ? "opacity-0" : "opacity-100"}`}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleError}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            preload="metadata"
          />
        </div>

        {/* Video Controls */}
        {!error && (
          <div className="border-t border-white/10 bg-neutral-800/70 px-4 py-3">
            {/* Progress bar */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs text-neutral-400 w-14 text-right font-mono">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-1.5 rounded-full appearance-none bg-neutral-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-emerald-500/30"
              />
              <span className="text-xs text-neutral-400 w-14 font-mono">
                {formatTime(duration)}
              </span>
            </div>

            {/* Playback controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-400 text-neutral-900 transition shadow-lg shadow-emerald-500/30"
                  disabled={isLoading}
                >
                  {isPlaying ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Volume control */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/10 transition"
                >
                  {isMuted || volume === 0 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1 rounded-full appearance-none bg-neutral-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-300"
                />
              </div>
            </div>
          </div>
        )}

        {/* Media Details */}
        <div className="border-t border-white/10 bg-neutral-800/30 px-5 py-4">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3">Media Details</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-neutral-500 mb-1">Format</p>
              <p className="text-sm font-medium text-neutral-200 uppercase">
                {item.format || "Unknown"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">Duration</p>
              <p className="text-sm font-medium text-neutral-200">
                {item.durationSeconds ? formatTime(item.durationSeconds) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">Playback</p>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                  item.supported
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "bg-amber-500/20 text-amber-200"
                }`}
              >
                {item.supported
                  ? item.supportedViaCompanion
                    ? "Companion"
                    : "Native"
                  : "Unsupported"}
              </span>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">Source</p>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                  mediaSource === "remote"
                    ? "bg-blue-500/20 text-blue-200"
                    : "bg-emerald-500/20 text-emerald-200"
                }`}
              >
                {mediaSource === "remote" ? "CDN" : "Local"}
              </span>
            </div>
          </div>
          {item.title && (
            <div className="mt-4 pt-3 border-t border-white/5">
              <p className="text-xs text-neutral-500 mb-1">Title</p>
              <p className="text-sm text-neutral-200">{item.title}</p>
            </div>
          )}

          {/* Conversion Helper */}
          {shouldShowConvert(item) && (
            <div className="mt-4 pt-3 border-t border-white/5 space-y-2">
              <p className="text-xs text-neutral-400">
                {getConversionDescription(item)}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyConvertCommand(item, setCopiedCommand)}
                  className="rounded-md border border-white/20 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30"
                >
                  {copiedCommand ? "Copied!" : "Copy conversion command"}
                </button>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  needsFullReencode(item)
                    ? "bg-amber-500/20 text-amber-200"
                    : "bg-blue-500/20 text-blue-200"
                }`}>
                  {needsFullReencode(item) ? "Full re-encode" : "Remux + audio"}
                </span>
              </div>
            </div>
          )}
        </div>
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
}: {
  report: ScanReport;
  onClose: () => void;
}) {
  const [showAllFiles, setShowAllFiles] = useState(false);
  const { stats, fileResults, message } = report;
  
  // Separate files into categories
  const filesWithIssues = fileResults.filter(f => !f.probeSuccess || f.durationSeconds === 0);
  const filesOk = fileResults.filter(f => f.probeSuccess && f.durationSeconds > 0);
  
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
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
              <p className="text-xs text-neutral-400">Zero Duration</p>
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
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>
        </div>
        
        {/* File Lists */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Files with issues */}
          {filesWithIssues.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-amber-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Files Needing Attention ({filesWithIssues.length})
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
                    <div className="flex-shrink-0">
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
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [mediaRefreshToken, setMediaRefreshToken] = useState(0);
  const [pushingManifest, setPushingManifest] = useState(false);
  const [scanningRemote, setScanningRemote] = useState(false);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [supportedFilter, setSupportedFilter] = useState<"all" | "supported" | "unsupported">(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [manifestUpdatedAt, setManifestUpdatedAt] = useState<string | null>(null);

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

  // Load available media list
  useEffect(() => {
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

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) =>
        a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" }),
      ),
    [files],
  );

  const availableFormats = useMemo(() => {
    const formats = new Set<string>();
    files.forEach((file) => {
      if (file.format) {
        formats.add(file.format.toUpperCase());
      }
    });
    return Array.from(formats).sort();
  }, [files]);

  const filteredFiles = useMemo(() => {
    return sortedFiles.filter((file) => {
      // Format filter
      if (formatFilter !== "all" && (file.format || "").toUpperCase() !== formatFilter) {
        return false;
      }
      // Support filter
      if (supportedFilter === "supported" && !file.supported) return false;
      if (supportedFilter === "unsupported" && file.supported) return false;
      // Search query
      if (searchQuery && !file.relPath.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [sortedFiles, formatFilter, supportedFilter, searchQuery]);

  const totalDurationSeconds = useMemo(
    () => sortedFiles.reduce((sum, f) => sum + (f.durationSeconds || 0), 0),
    [sortedFiles],
  );

  const refreshMediaList = () => {
    setMediaRefreshToken((token) => token + 1);
  };

  const pushRemoteManifest = async () => {
    setPushingManifest(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/media-index/push", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Upload failed");
      }
      setMessage(data.message || "Uploaded media-index.json");
      refreshMediaList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPushingManifest(false);
    }
  };

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
      
      // Show scan report modal if we have detailed results
      if (data.fileResults && data.stats) {
        setScanReport({
          fileResults: data.fileResults,
          stats: data.stats,
          message: data.message || `Scanned ${data.count} files`,
        });
      } else {
        setMessage(data.message || `Scanned remote and found ${data.count} files`);
      }
      
      refreshMediaList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanningRemote(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">
            Media Library
          </p>
          <p className="text-sm text-neutral-400">
            Single source of truth for all media files based on current source settings ({mediaSource === "remote" ? "Remote CDN" : "Local files"}).
          </p>
          {manifestUpdatedAt && (
            <p className="text-xs text-neutral-500 mt-1">
              Media index JSON updated {formatDateTime(manifestUpdatedAt)}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold flex-shrink-0 ${
            mediaSource === "remote"
              ? "bg-blue-500/20 text-blue-200"
              : "bg-emerald-500/20 text-emerald-200"
          }`}
        >
          {mediaSource === "remote" ? "Remote" : "Local"}
        </span>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Total Files</p>
          <p className="text-2xl font-semibold text-neutral-50">{sortedFiles.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Supported</p>
          <p className="text-2xl font-semibold text-emerald-300">
            {sortedFiles.filter((f) => f.supported || f.supportedViaCompanion).length}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs text-neutral-400 mb-1">Total Duration</p>
          <p className="text-2xl font-semibold text-neutral-50">
            {formatDuration(totalDurationSeconds)}
          </p>
        </div>
      </div>

      {/* Media Table */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
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
            {mediaSource === "remote" && (
              <>
                <button
                  onClick={() => void pushRemoteManifest()}
                  disabled={loading || pushingManifest}
                  className="rounded-md border border-blue-300/50 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                  title="Rebuild and upload media-index.json to the remote server"
                >
                  {pushingManifest ? "Updating JSON…" : "Update JSON"}
                </button>
                <button
                  onClick={() => void scanRemoteMedia()}
                  disabled={loading || scanningRemote}
                  className="rounded-md border border-blue-300/50 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                  title="Scan remote folder via FTP and regenerate media-index.json"
                >
                  {scanningRemote ? "Scanning…" : "Rescan Remote"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filters and Search */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by filename..."
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-300 focus:bg-white/10"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Format</label>
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100"
            >
              <option value="all">All</option>
              {availableFormats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Supported</label>
            <select
              value={supportedFilter}
              onChange={(e) => setSupportedFilter(e.target.value as typeof supportedFilter)}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-neutral-100"
            >
              <option value="all">All</option>
              <option value="supported">Supported</option>
              <option value="unsupported">Unsupported</option>
            </select>
          </div>
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
              <div className="overflow-hidden rounded-lg border border-white/5">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-white/5 text-neutral-200">
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
                  <tbody className="divide-y divide-white/5 bg-neutral-950/40 text-neutral-100">
                    {filteredFiles.map((file) => (
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
                        <td className="px-3 py-2 text-left text-neutral-200 uppercase">
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
                        <td className="px-3 py-2 text-right text-neutral-200">
                          {formatDuration(file.durationSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-amber-300">{error}</p>}

      {selectedFile && (
        <MediaDetailModal
          item={selectedFile}
          mediaSource={mediaSource}
          onClose={() => setSelectedFile(null)}
        />
      )}

      {scanReport && (
        <ScanReportModal
          report={scanReport}
          onClose={() => setScanReport(null)}
        />
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

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shouldShowConvert(file: MediaFile): boolean {
  if (file.supportedViaCompanion) return false;
  if (!file.supported) return true;
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  if (ext === "mkv") return true;
  return false;
}

function needsFullReencode(file: MediaFile): boolean {
  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  const filename = file.relPath.toLowerCase();
  
  const fullReencodeExtensions = ["avi", "wmv", "asf", "flv", "mpeg", "mpg", "vob", "ogv", "ogg", "3gp", "3g2"];
  
  const isH264 = filename.includes("x264") || 
                 filename.includes("h264") || 
                 filename.includes("h.264") ||
                 filename.includes("avc");
  
  if (ext === "avi" && isH264) return false;
  if (fullReencodeExtensions.includes(ext)) return true;
  
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

  const ext = file.relPath.split(".").pop()?.toLowerCase() || "";
  
  switch (ext) {
    case "avi":
      if (file.relPath.toLowerCase().includes("x264") || 
          file.relPath.toLowerCase().includes("h264") ||
          file.relPath.toLowerCase().includes("h.264")) {
        return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "wmv":
    case "asf":
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "flv":
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mov":
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mkv":
      if (file.format?.toLowerCase()?.includes("hevc") || 
          file.format?.toLowerCase()?.includes("x265") ||
          file.relPath.toLowerCase().includes("x265") ||
          file.relPath.toLowerCase().includes("hevc")) {
        return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mpeg":
    case "mpg":
    case "vob":
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "ts":
    case "m2ts":
    case "mts":
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "webm":
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "ogv":
    case "ogg":
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "3gp":
    case "3g2":
      return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    case "mp4":
    case "m4v":
      if (file.format?.toLowerCase()?.includes("hevc") || 
          file.format?.toLowerCase()?.includes("x265") ||
          file.relPath.toLowerCase().includes("x265") ||
          file.relPath.toLowerCase().includes("hevc")) {
        return `ffmpeg -i ${inputPath} -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
      }
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
    
    default:
      return `ffmpeg -i ${inputPath} -c:v copy -c:a aac -b:a 192k -movflags +faststart ${outputPath}`;
  }
}

function escapeDoubleQuotes(value: string): string {
  return value.replace(/(["\\`$])/g, "\\$1");
}

