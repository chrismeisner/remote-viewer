"use client";

import { useCallback, useEffect, useState } from "react";

type ServiceStatus = {
  id: string;
  name: string;
  description: string;
  status: "ok" | "warning" | "error" | "unconfigured";
  message: string;
  latencyMs?: number;
};

type StatusResponse = {
  services: ServiceStatus[];
  summary: {
    ok: number;
    warning: number;
    error: number;
    unconfigured: number;
    total: number;
  };
  checkedAt: string;
};

const STATUS_STYLES: Record<
  ServiceStatus["status"],
  { dot: string; bg: string; border: string; label: string; text: string }
> = {
  ok: {
    dot: "bg-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-400/30",
    label: "Connected",
    text: "text-emerald-300",
  },
  warning: {
    dot: "bg-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-400/30",
    label: "Warning",
    text: "text-amber-300",
  },
  error: {
    dot: "bg-red-400",
    bg: "bg-red-500/10",
    border: "border-red-400/30",
    label: "Error",
    text: "text-red-300",
  },
  unconfigured: {
    dot: "bg-neutral-500",
    bg: "bg-neutral-500/10",
    border: "border-neutral-500/30",
    label: "Not Configured",
    text: "text-neutral-400",
  },
};

function StatusBadge({ status }: { status: ServiceStatus["status"] }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.border} ${style.text}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function SummaryCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className={`rounded-md border p-4 ${color}`}>
      <p className="text-xs opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-bold">{count}</p>
    </div>
  );
}

export default function ServicesPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/services/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StatusResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">
            Service Status
          </h1>
          <p className="text-sm text-neutral-400">
            Health and configuration of all connected services
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
          Failed to load service status: {error}
        </div>
      )}

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SummaryCard
            label="Operational"
            count={data.summary.ok}
            color="border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
          />
          <SummaryCard
            label="Warnings"
            count={data.summary.warning}
            color="border-amber-400/20 bg-amber-500/10 text-amber-100"
          />
          <SummaryCard
            label="Errors"
            count={data.summary.error}
            color="border-red-400/20 bg-red-500/10 text-red-100"
          />
          <SummaryCard
            label="Not Configured"
            count={data.summary.unconfigured}
            color="border-neutral-500/20 bg-neutral-500/10 text-neutral-300"
          />
        </div>
      )}

      {/* Checked-at timestamp */}
      {data && (
        <p className="text-xs text-neutral-500">
          Last checked:{" "}
          {new Date(data.checkedAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          })}
        </p>
      )}

      {/* Service List */}
      {data && (
        <div className="space-y-3">
          {data.services.map((svc) => {
            const style = STATUS_STYLES[svc.status];
            return (
              <div
                key={svc.id}
                className={`rounded-lg border p-4 ${style.border} ${style.bg}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-sm font-semibold text-neutral-50">
                        {svc.name}
                      </h3>
                      <StatusBadge status={svc.status} />
                      {svc.latencyMs !== undefined && (
                        <span className="text-xs text-neutral-500">
                          {svc.latencyMs}ms
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 mb-1.5">
                      {svc.description}
                    </p>
                    <p className="text-xs text-neutral-300 break-all">
                      {svc.message}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Loading State */}
      {loading && !data && (
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-8 text-center">
          <div className="inline-block h-8 w-8 border-2 border-neutral-400 border-t-emerald-400 rounded-full animate-spin mb-3" />
          <p className="text-sm text-neutral-400">
            Checking service connections…
          </p>
        </div>
      )}

      {/* All Good State */}
      {data &&
        data.summary.error === 0 &&
        data.summary.warning === 0 &&
        data.summary.unconfigured === 0 && (
          <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 p-8 text-center">
            <div className="text-4xl mb-3">&#10003;</div>
            <h3 className="text-lg font-semibold text-emerald-100 mb-1">
              All Systems Operational
            </h3>
            <p className="text-sm text-emerald-200/70">
              Every service is configured and responding normally.
            </p>
          </div>
        )}
    </div>
  );
}
