"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

type Channel = {
  id: string;
  shortName?: string;
};

export default function ChannelAdminPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");

  const isRemote = mediaSource === "remote";
  const apiBase = isRemote ? "/api/channels/remote" : "/api/channels";

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

  // Load channels
  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}?source=${mediaSource}`);
      if (!res.ok) throw new Error("Failed to load channels");
      const data = await res.json();
      setChannels(Array.isArray(data.channels) ? data.channels : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [apiBase, mediaSource]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  // Create channel
  const handleCreate = async () => {
    const id = newId.trim();
    if (!id) return;
    setSaving("create");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, shortName: newShortName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setChannels(data.channels);
      setNewId("");
      setNewShortName("");
      setMessage(`Channel "${id}" created`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(null);
    }
  };

  // Update channel shortName
  const handleUpdateShortName = async (channelId: string, shortName: string) => {
    setSaving(channelId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: channelId, shortName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setChannels(data.channels);
      setMessage(`Channel "${channelId}" updated`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(null);
    }
  };

  // Delete channel
  const handleDelete = async (channelId: string) => {
    if (!confirm(`Delete channel "${channelId}"?`)) return;
    setSaving(channelId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}?id=${encodeURIComponent(channelId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setChannels(data.channels);
      setMessage(`Channel "${channelId}" deleted`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">Channels</h1>
          <p className="text-sm text-neutral-400">
            Manage channels for the {isRemote ? "remote" : "local"} source
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
          <p className="mt-1 text-xs text-blue-200">
            Channels stored at{" "}
            <code className="rounded bg-blue-500/20 px-1">{REMOTE_MEDIA_BASE}channels.json</code>.
            Changes pushed via FTP.
          </p>
        </div>
      )}

      {/* Create new channel */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          placeholder="Channel number (e.g., 1)"
          className="w-44 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-neutral-100 placeholder:text-neutral-500"
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <input
          value={newShortName}
          onChange={(e) => setNewShortName(e.target.value)}
          placeholder="Short name (optional)"
          className="w-48 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-neutral-100 placeholder:text-neutral-500"
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <button
          onClick={handleCreate}
          disabled={saving === "create" || !newId.trim()}
          className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {saving === "create" ? "Creating…" : "Create"}
        </button>
        <button
          onClick={loadChannels}
          disabled={loading}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Channels list */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">
              {isRemote ? "Remote" : "Local"} Channels
            </h3>
            <p className="text-xs text-neutral-400">
              {isRemote
                ? "Stored in channels.json on remote CDN"
                : "Stored in data/channels.json"}
            </p>
          </div>
          <span className="text-xs text-neutral-400">
            {channels.length} channel{channels.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-300">Loading…</p>
        ) : channels.length === 0 ? (
          <p className="text-sm text-neutral-300">
            No channels yet. Create one above to get started.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-neutral-200">
                <tr>
                  <th className="w-24 px-3 py-2 text-left font-semibold">Number</th>
                  <th className="px-3 py-2 text-left font-semibold">Short Name</th>
                  <th className="w-48 px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/50">
                {channels.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    saving={saving === channel.id}
                    onUpdateShortName={(shortName) =>
                      handleUpdateShortName(channel.id, shortName)
                    }
                    onDelete={() => handleDelete(channel.id)}
                  />
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

// Individual row component to manage local edit state
function ChannelRow({
  channel,
  saving,
  onUpdateShortName,
  onDelete,
}: {
  channel: Channel;
  saving: boolean;
  onUpdateShortName: (shortName: string) => void;
  onDelete: () => void;
}) {
  const [localShortName, setLocalShortName] = useState(channel.shortName ?? "");
  const hasChanged = localShortName !== (channel.shortName ?? "");

  // Reset local state when channel data changes from server
  useEffect(() => {
    setLocalShortName(channel.shortName ?? "");
  }, [channel.shortName]);

  return (
    <tr className="text-neutral-100">
      <td className="px-3 py-2">
        <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-200">
          {channel.id}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            value={localShortName}
            onChange={(e) => setLocalShortName(e.target.value)}
            placeholder="Enter short name"
            className="w-40 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && hasChanged) {
                onUpdateShortName(localShortName);
              }
            }}
          />
          {hasChanged && (
            <button
              onClick={() => onUpdateShortName(localShortName)}
              disabled={saving}
              className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-2">
          <Link
            href={`/admin/schedule?channel=${encodeURIComponent(channel.id)}`}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
          >
            Schedule
          </Link>
          <button
            onClick={onDelete}
            disabled={saving}
            className="rounded-md border border-red-400/50 bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-100 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
