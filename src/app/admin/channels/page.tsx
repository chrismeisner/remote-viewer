"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFAULT_CHANNEL } from "@/constants/channels";

export default function ChannelAdminPage() {
  const [channels, setChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [newChannel, setNewChannel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadChannels();
  }, []);

  const loadChannels = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error("Failed to load channels");
      const data = await res.json();
      const names =
        Array.isArray(data.channels) && data.channels.length > 0
          ? data.channels
          : ["default"];
      setChannels(names);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const name = newChannel.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to create channel");
      }
      setMessage(`Channel "${name}" created`);
      setNewChannel("");
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (name: string) => {
    setDeleting((prev) => ({ ...prev, [name]: true }));
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/channels?channel=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to delete channel");
      }
      setMessage(`Channel "${name}" deleted`);
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete channel");
    } finally {
      setDeleting((prev) => ({ ...prev, [name]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-300">
          Channel Admin
        </p>
        <p className="text-sm text-slate-400">
          Create or remove 24h schedule channels
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          value={newChannel}
          onChange={(e) => setNewChannel(e.target.value)}
          placeholder="New channel name"
          className="w-64 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-slate-100 placeholder:text-slate-500"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newChannel.trim()}
          className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create channel"}
        </button>
        <button
          onClick={loadChannels}
          disabled={loading}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 shadow-lg shadow-black/30">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Channels</h3>
              <p className="text-xs text-slate-400">
                Delete a channel to remove its schedule file. Channel "{DEFAULT_CHANNEL}" cannot
                be deleted.
              </p>
            </div>
            <span className="text-xs text-slate-400">
              {channels.length} channel{channels.length === 1 ? "" : "s"}
            </span>
          </div>
          {loading ? (
            <p className="text-sm text-slate-300">Loading…</p>
          ) : channels.length === 0 ? (
            <p className="text-sm text-slate-300">No channels found.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Channel</th>
                    <th className="px-3 py-2 text-right font-semibold w-32">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-slate-950/50">
                  {channels.map((name) => (
                    <tr key={name} className="text-slate-100">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-semibold text-slate-200">
                            {name}
                          </span>
                          {name === "default" && (
                            <span className="text-[11px] text-slate-400">default</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/admin/schedule?channel=${encodeURIComponent(name)}`}
                            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
                          >
                            Edit schedule
                          </Link>
                          <button
                            onClick={() => handleDelete(name)}
                            disabled={name === DEFAULT_CHANNEL || deleting[name]}
                            className="rounded-md border border-red-400/50 bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-100 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
                          >
                            {deleting[name] ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-amber-300">{error}</p>}
    </div>
  );
}

