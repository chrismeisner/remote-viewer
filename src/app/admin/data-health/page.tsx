"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

type AuditIssue = {
  id: string;
  file: string;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  fixable: boolean;
  fixAction?: string;
};

type FileInfo = {
  name: string;
  exists: boolean;
  path?: string;
  url?: string;
  size?: number;
};

type AuditResult = {
  success: boolean;
  mode: "local" | "remote";
  issues: AuditIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    fixable: number;
  };
  files: FileInfo[];
  error?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SeverityBadge({ severity }: { severity: AuditIssue["severity"] }) {
  const styles = {
    error: "bg-red-500/20 text-red-200 border-red-400/30",
    warning: "bg-amber-500/20 text-amber-200 border-amber-400/30",
    info: "bg-blue-500/20 text-blue-200 border-blue-400/30",
  };

  const labels = {
    error: "Error",
    warning: "Warning",
    info: "Info",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${styles[severity]}`}
    >
      {labels[severity]}
    </span>
  );
}

export default function DataHealthPage() {
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("remote");

  // Sync media source from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      if (stored === "remote" || stored === "local") {
        setMediaSource(stored);
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

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/json-audit?mode=${mediaSource}`, { cache: "no-store" });
      const data = await res.json();
      setAuditResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run audit");
    } finally {
      setLoading(false);
    }
  }, [mediaSource]);

  useEffect(() => {
    void runAudit();
  }, [runAudit]);

  const applyFix = async (action: string, issueId: string) => {
    setFixing(issueId);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/json-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Fix failed");
      }
      setMessage(data.message);
      await runAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fix failed");
    } finally {
      setFixing(null);
    }
  };

  const fixAll = async () => {
    if (!auditResult) return;
    
    const fixableIssues = auditResult.issues.filter(i => i.fixable && i.fixAction);
    const uniqueActions = [...new Set(fixableIssues.map(i => i.fixAction!))];
    
    setFixing("all");
    setMessage(null);
    setError(null);
    
    try {
      for (const action of uniqueActions) {
        const res = await fetch("/api/json-audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || `Fix failed: ${action}`);
        }
      }
      setMessage(`Applied ${uniqueActions.length} fix(es) successfully`);
      await runAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fix failed");
    } finally {
      setFixing(null);
    }
  };

  // Group issues by file
  const issuesByFile = auditResult?.issues.reduce((acc, issue) => {
    if (!acc[issue.file]) acc[issue.file] = [];
    acc[issue.file].push(issue);
    return acc;
  }, {} as Record<string, AuditIssue[]>) ?? {};

  const isRemote = auditResult?.mode === "remote";

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">Data Health</h1>
          <p className="text-sm text-neutral-400">
            Audit and clean up your JSON data files
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
            isRemote ? "bg-blue-500/20 text-blue-200" : "bg-emerald-500/20 text-emerald-200"
          }`}>
            {isRemote ? "Remote" : "Local"}
          </div>
          <button
            onClick={() => void runAudit()}
            disabled={loading}
            className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Re-scan"}
          </button>
        </div>
      </div>

      {/* Mode Info Banner */}
      {auditResult && (
        <div className={`rounded-lg border p-4 ${
          isRemote 
            ? "border-blue-400/30 bg-blue-500/10" 
            : "border-emerald-400/30 bg-emerald-500/10"
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={`text-sm font-medium ${isRemote ? "text-blue-100" : "text-emerald-100"}`}>
                {isRemote ? "Auditing Remote CDN Files" : "Auditing Local Files"}
              </p>
              <p className={`text-xs mt-1 ${isRemote ? "text-blue-200/70" : "text-emerald-200/70"}`}>
                {isRemote ? (
                  <>Checking files at <code className="bg-black/20 px-1 rounded">{REMOTE_MEDIA_BASE}</code></>
                ) : (
                  "Checking files in your configured media folder"
                )}
              </p>
            </div>
            {isRemote && (
              <p className="text-xs text-blue-200/70">
                Fixes require pushing from local →{" "}
                <Link href="/admin/source" className="underline hover:text-blue-100">
                  Source
                </Link>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {auditResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
            <p className="text-xs text-neutral-400 mb-1">Total Issues</p>
            <p className="text-2xl font-bold text-neutral-50">
              {auditResult.summary.total}
            </p>
          </div>
          <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4">
            <p className="text-xs text-red-300 mb-1">Errors</p>
            <p className="text-2xl font-bold text-red-100">
              {auditResult.summary.errors}
            </p>
          </div>
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4">
            <p className="text-xs text-amber-300 mb-1">Warnings</p>
            <p className="text-2xl font-bold text-amber-100">
              {auditResult.summary.warnings}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4">
            <p className="text-xs text-emerald-300 mb-1">Fixable</p>
            <p className="text-2xl font-bold text-emerald-100">
              {auditResult.summary.fixable}
            </p>
          </div>
        </div>
      )}

      {/* Fix All Button - Only for local mode with fixable issues */}
      {auditResult && !isRemote && auditResult.summary.fixable > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => void fixAll()}
            disabled={fixing !== null}
            className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {fixing === "all" ? "Fixing…" : `Fix All (${auditResult.summary.fixable})`}
          </button>
          <span className="text-xs text-neutral-500">
            Apply all safe automatic fixes
          </span>
        </div>
      )}

      {/* Status Messages */}
      {message && (
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          ✓ {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
          ✕ {error}
        </div>
      )}

      {/* Files Overview */}
      {auditResult && auditResult.files.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
          <h2 className="text-sm font-semibold text-neutral-100 mb-4">JSON Files</h2>
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-neutral-200">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">File</th>
                  <th className="px-4 py-2 text-left font-semibold">Status</th>
                  <th className="px-4 py-2 text-left font-semibold">{isRemote ? "URL" : "Size"}</th>
                  <th className="px-4 py-2 text-left font-semibold">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/50">
                {auditResult.files.map((file) => {
                  const fileIssues = issuesByFile[file.name] || [];
                  const hasErrors = fileIssues.some(i => i.severity === "error");
                  const hasWarnings = fileIssues.some(i => i.severity === "warning");
                  
                  return (
                    <tr key={file.name}>
                      <td className="px-4 py-3">
                        {file.url ? (
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-300 hover:text-blue-200 hover:underline"
                          >
                            <code className="rounded bg-white/5 px-2 py-1 text-xs">
                              {file.name}
                            </code>
                          </a>
                        ) : (
                          <code className="rounded bg-white/5 px-2 py-1 text-xs text-neutral-100">
                            {file.name}
                          </code>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {file.exists ? (
                          <span className="inline-flex items-center gap-1 text-emerald-300 text-xs">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            Found
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-300 text-xs">
                            <span className="h-2 w-2 rounded-full bg-red-400" />
                            Missing
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-400 text-xs">
                        {isRemote ? (
                          file.url ? <span className="truncate max-w-[200px] block">{file.url}</span> : "—"
                        ) : (
                          file.size !== undefined ? formatBytes(file.size) : "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {fileIssues.length === 0 ? (
                          <span className="text-xs text-emerald-400">✓ Clean</span>
                        ) : (
                          <span className={`text-xs font-medium ${
                            hasErrors ? "text-red-300" : hasWarnings ? "text-amber-300" : "text-blue-300"
                          }`}>
                            {fileIssues.length} issue{fileIssues.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Issues by File */}
      {auditResult && Object.keys(issuesByFile).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-neutral-100">Issues</h2>
          
          {Object.entries(issuesByFile).map(([fileName, issues]) => (
            <div
              key={fileName}
              className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30"
            >
              <div className="flex items-center gap-3 mb-4">
                <code className="rounded bg-white/10 px-2 py-1 text-sm text-neutral-100">
                  {fileName}
                </code>
                <span className="text-xs text-neutral-500">
                  {issues.length} issue{issues.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="space-y-3">
                {issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="rounded-lg border border-white/5 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <SeverityBadge severity={issue.severity} />
                          <span className="text-sm font-medium text-neutral-100">
                            {issue.title}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-400">
                          {issue.description}
                        </p>
                      </div>
                      {issue.fixable && issue.fixAction && !isRemote && (
                        <button
                          onClick={() => void applyFix(issue.fixAction!, issue.id)}
                          disabled={fixing !== null}
                          className="shrink-0 rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                        >
                          {fixing === issue.id ? "Fixing…" : "Fix"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All Clean State */}
      {auditResult && auditResult.summary.total === 0 && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-8 text-center">
          <div className="text-4xl mb-3">✓</div>
          <h3 className="text-lg font-semibold text-emerald-100 mb-1">
            All Data Files Are Clean
          </h3>
          <p className="text-sm text-emerald-200/70">
            No issues found in your {isRemote ? "remote" : "local"} JSON data files.
          </p>
        </div>
      )}

      {/* Loading State */}
      {loading && !auditResult && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-8 text-center">
          <div className="inline-block h-8 w-8 border-2 border-neutral-400 border-t-emerald-400 rounded-full animate-spin mb-3" />
          <p className="text-sm text-neutral-400">Scanning {mediaSource} data files…</p>
        </div>
      )}
    </div>
  );
}
