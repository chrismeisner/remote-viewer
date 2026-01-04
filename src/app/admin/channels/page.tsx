"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

type ChannelInfo = {
  id: string;
  shortName?: string;
};

export default function ChannelAdminPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [newChannel, setNewChannel] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [editingShortName, setEditingShortName] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");

  // Load and sync media source preference
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

  // Reload channels when source changes
  useEffect(() => {
    void loadChannels();
  }, [mediaSource]);

  const isRemote = mediaSource === "remote";

  // Normalize legacy string[] format to ChannelInfo[]
  const normalizeChannels = (channels: unknown): ChannelInfo[] => {
    if (!Array.isArray(channels)) return [];
    return channels.map((ch) => {
      if (typeof ch === "string") {
        return { id: ch };
      }
      if (ch && typeof ch === "object" && typeof (ch as ChannelInfo).id === "string") {
        return ch as ChannelInfo;
      }
      return null;
    }).filter(Boolean) as ChannelInfo[];
  };

  const loadChannels = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/channels?source=${encodeURIComponent(mediaSource)}`,
      );
      if (!res.ok) throw new Error("Failed to load channels");
      const data = await res.json();
      const channelList = normalizeChannels(data.channels);
      setChannels(channelList);
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
      // Use different endpoint based on source
      const endpoint = isRemote ? "/api/channels/remote" : "/api/channels";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, shortName: newShortName.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to create channel");
      }
      setMessage(`Channel "${name}" created${isRemote ? " (pushed to remote)" : ""}`);
      setNewChannel("");
      setNewShortName("");
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateShortName = async (channelId: string) => {
    const shortName = editingShortName[channelId] ?? "";
    setEditing((prev) => ({ ...prev, [channelId]: true }));
    setError(null);
    setMessage(null);
    try {
      // Use different endpoint based on source
      const endpoint = isRemote ? "/api/channels/remote" : "/api/channels";
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channelId, shortName: shortName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to update channel");
      }
      setMessage(`Short name updated for channel "${channelId}"${isRemote ? " (pushed to remote)" : ""}`);
      await loadChannels();
      // Clear editing state
      setEditingShortName((prev) => {
        const next = { ...prev };
        delete next[channelId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update channel");
    } finally {
      setEditing((prev) => ({ ...prev, [channelId]: false }));
    }
  };

  const handleDelete = async (channelId: string) => {
    setDeleting((prev) => ({ ...prev, [channelId]: true }));
    setError(null);
    setMessage(null);
    try {
      // Use different endpoint based on source
      const endpoint = isRemote
        ? `/api/channels/remote?channel=${encodeURIComponent(channelId)}`
        : `/api/channels?channel=${encodeURIComponent(channelId)}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to delete channel");
      }
      setMessage(`Channel "${channelId}" deleted${isRemote ? " (removed from remote)" : ""}`);
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete channel");
    } finally {
      setDeleting((prev) => ({ ...prev, [channelId]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">Channels</h1>
          <p className="text-sm text-slate-400">
            Manage 24h schedule channels for the active source
          </p>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            isRemote
              ? "bg-blue-500/20 text-blue-200"
              : "bg-emerald-500/20 text-emerald-200"
          }`}
        >
          {isRemote ? "Remote" : "Local"}
        </div>
      </div>

      {isRemote && (
        <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-3 text-sm text-blue-100">
          <p className="font-semibold">Remote Source Active</p>
          <p className="text-xs text-blue-200 mt-1">
            Channels are synced with{" "}
            <code className="bg-blue-500/20 px-1 rounded">{REMOTE_MEDIA_BASE}channels.json</code>.
            Changes will be pushed to the remote server via FTP.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          value={newChannel}
          onChange={(e) => setNewChannel(e.target.value)}
          placeholder="Channel number (e.g., 1)"
          className="w-40 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-slate-100 placeholder:text-slate-500"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newChannel.trim()) {
              void handleCreate();
            }
          }}
        />
        <input
          value={newShortName}
          onChange={(e) => setNewShortName(e.target.value)}
          placeholder="Short name (optional)"
          className="w-48 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-slate-100 placeholder:text-slate-500"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newChannel.trim()) {
              void handleCreate();
            }
          }}
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
            <h3 className="text-sm font-semibold text-slate-100">
              {isRemote ? "Remote Channels" : "Local Channels"}
            </h3>
            <p className="text-xs text-slate-400">
              Each channel has its own 24h schedule.
              {isRemote
                ? " Stored in schedule.json on remote CDN."
                : " Stored in data/schedule.json."}
            </p>
          </div>
          <span className="text-xs text-slate-400">
            {channels.length} channel{channels.length === 1 ? "" : "s"}
          </span>
        </div>
        {loading ? (
          <p className="text-sm text-slate-300">Loading…</p>
        ) : channels.length === 0 ? (
          <p className="text-sm text-slate-300">
            No channels yet. Create one above to get started.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold w-24">Number</th>
                  <th className="px-3 py-2 text-left font-semibold">Short Name</th>
                  <th className="px-3 py-2 text-right font-semibold w-56">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-950/50">
                {channels.map((channel) => {
                  const isEditingThis = editingShortName[channel.id] !== undefined;
                  const currentShortName = isEditingThis 
                    ? editingShortName[channel.id] 
                    : (channel.shortName ?? "");
                  
                  return (
                    <tr key={channel.id} className="text-slate-100">
                      <td className="px-3 py-2">
                        <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-semibold text-slate-200">
                          {channel.id}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            value={currentShortName}
                            onChange={(e) =>
                              setEditingShortName((prev) => ({
                                ...prev,
                                [channel.id]: e.target.value,
                              }))
                            }
                            placeholder="Enter short name"
                            className="w-40 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && isEditingThis) {
                                void handleUpdateShortName(channel.id);
                              }
                            }}
                          />
                          {isEditingThis && (
                            <button
                              onClick={() => handleUpdateShortName(channel.id)}
                              disabled={editing[channel.id]}
                              className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                            >
                              {editing[channel.id] ? "Saving…" : "Save"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/admin/schedule?channel=${encodeURIComponent(channel.id)}`}
                            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
                          >
                            Edit schedule
                          </Link>
                          <button
                            onClick={() => handleDelete(channel.id)}
                            disabled={deleting[channel.id]}
                            className="rounded-md border border-red-400/50 bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-100 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
                          >
                            {deleting[channel.id] ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

