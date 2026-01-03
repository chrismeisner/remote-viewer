"use client";

import { useState } from "react";

type TestResult = {
  success: boolean;
  message: string;
  cwd?: string;
  entries?: Array<{ name: string; type: string; size?: number }>;
  writeTest?: { success: boolean; message: string };
};

export default function FtpTestPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const runTest = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/ftp-test");
      const data = (await res.json()) as TestResult;
      if (!res.ok || !data.success) {
        throw new Error(data?.message || "FTP test failed");
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "FTP test failed");
    } finally {
      setLoading(false);
    }
  };

  const uploadManifest = async () => {
    setPushing(true);
    setPushMessage(null);
    setPushError(null);
    try {
      const res = await fetch("/api/media-index/push", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Upload failed");
      }
      setPushMessage(data.message || "Uploaded manifest");
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8 text-slate-100">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-300">FTP Test</p>
        <p className="text-sm text-slate-400">
          Uses FTP_HOST/FTP_USER/FTP_PASS/FTP_REMOTE_PATH from env to try a connection and list the
          target directory.
        </p>
      </div>

      <button
        onClick={runTest}
        disabled={loading}
        className="w-fit rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
      >
        {loading ? "Testing…" : "Run FTP test"}
      </button>

      <div className="flex items-center gap-3">
        <button
          onClick={uploadManifest}
          disabled={pushing}
          className="w-fit rounded-md border border-blue-300/50 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-50 transition hover:border-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
        >
          {pushing ? "Uploading…" : "Generate & upload media-index.json"}
        </button>
        <p className="text-xs text-slate-400">
          Builds manifest from local media scan and uploads via FTP_REMOTE_PATH.
        </p>
      </div>

      {pushMessage && (
        <div className="rounded-lg border border-emerald-300/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          {pushMessage}
        </div>
      )}
      {pushError && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          {pushError}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-200">
          <p className="font-semibold text-emerald-200">{result.message}</p>
          {result.cwd && <p className="text-xs text-slate-400">Dir: {result.cwd}</p>}
          {result.writeTest && (
            <p className="mt-1 text-xs text-slate-300">
              Write test:{" "}
              <span
                className={
                  result.writeTest.success
                    ? "text-emerald-200"
                    : "text-amber-200"
                }
              >
                {result.writeTest.message}
              </span>
            </p>
          )}
          {Array.isArray(result.entries) && result.entries.length > 0 && (
            <div className="mt-2 rounded-md border border-white/10 bg-black/30 p-2 text-xs">
              <p className="mb-1 font-semibold text-slate-200">Entries</p>
              <ul className="space-y-1">
                {result.entries.map((e) => (
                  <li key={`${e.type}-${e.name}`} className="flex items-center justify-between">
                    <span>{e.name}</span>
                    <span className="text-slate-400">
                      {e.type} {typeof e.size === "number" ? `(${e.size} bytes)` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          {error}
        </div>
      )}
    </div>
  );
}

