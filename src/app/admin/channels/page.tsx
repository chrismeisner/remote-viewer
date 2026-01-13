"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  DATA_CHANGED_EVENT,
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  type MediaSource,
} from "@/constants/media";

type Channel = {
  id: string;
  shortName?: string;
  active?: boolean;
};

export default function ChannelAdminPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null); // Start as null until synced
  const [deleteModal, setDeleteModal] = useState<{ show: boolean; channel: Channel | null }>({
    show: false,
    channel: null,
  });
  const [editModal, setEditModal] = useState<{ show: boolean; channel: Channel | null }>({
    show: false,
    channel: null,
  });
  const [editId, setEditId] = useState("");
  const [editShortName, setEditShortName] = useState("");
  const [resetModal, setResetModal] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Sync media source from localStorage - must complete before loading channels
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
      const source: MediaSource = stored === "local" ? "local" : "remote";
      console.log("[Channels Page] Media source synced from localStorage:", source);
      setMediaSource(source);
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(MEDIA_SOURCE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(MEDIA_SOURCE_EVENT, sync);
    };
  }, []);

  // Load channels - uses single unified API
  const loadChannels = useCallback(async (forceRefresh = false, abortSignal?: AbortSignal) => {
    // Don't load until mediaSource is initialized from localStorage
    if (mediaSource === null) {
      console.log("[Channels Page] loadChannels skipped - mediaSource not yet initialized");
      return;
    }
    
    console.log("[Channels Page] loadChannels called", { mediaSource, forceRefresh });
    setLoading(true);
    setError(null);
    try {
      const refreshParam = forceRefresh ? "&refresh=true" : "";
      const url = `/api/channels?source=${mediaSource}${refreshParam}`;
      console.log("[Channels Page] Fetching from:", url);
      
      const res = await fetch(url, { cache: "no-store", signal: abortSignal });
      const data = await res.json();
      
      console.log("[Channels Page] API Response:", {
        status: res.status,
        ok: res.ok,
        source: data.source,
        requestedSource: mediaSource,
        channelCount: Array.isArray(data.channels) ? data.channels.length : 0,
        channels: data.channels,
        error: data.error,
      });
      
      if (!res.ok) throw new Error(data.error || "Failed to load channels");
      
      // Double-check the response source matches what we requested
      if (data.source !== mediaSource) {
        console.warn("[Channels Page] Response source mismatch - ignoring stale response", {
          expected: mediaSource,
          received: data.source,
        });
        return;
      }
      
      const channelsList = Array.isArray(data.channels) ? data.channels : [];
      console.log("[Channels Page] Setting channels state:", channelsList);
      setChannels(channelsList);
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === "AbortError") {
        console.log("[Channels Page] Request aborted (source changed)");
        return;
      }
      console.error("[Channels Page] Error loading channels:", err);
      setError(err instanceof Error ? err.message : "Failed to load");
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [mediaSource]);

  // Load channels on mount and when source changes - with abort controller
  useEffect(() => {
    // Don't load until mediaSource is initialized
    if (mediaSource === null) return;
    
    const abortController = new AbortController();
    console.log("[Channels Page] Starting channel load for source:", mediaSource);
    void loadChannels(false, abortController.signal);
    
    // Cleanup: abort the request if source changes before it completes
    return () => {
      console.log("[Channels Page] Aborting previous request due to source change or unmount");
      abortController.abort();
    };
  }, [mediaSource, loadChannels]);

  // Listen for data changes from other pages (e.g., fresh start)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onDataChanged = () => {
      void loadChannels();
    };
    window.addEventListener(DATA_CHANGED_EVENT, onDataChanged);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, onDataChanged);
    };
  }, [loadChannels]);

  // Create channel
  const handleCreate = async () => {
    const id = newId.trim();
    if (!id || !mediaSource) return;
    setSaving("create");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/channels?source=${mediaSource}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, shortName: newShortName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setChannels(data.channels || []);
      setNewId("");
      setNewShortName("");
      setMessage(`Channel "${id}" created`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(null);
    }
  };

  // Update channel
  const handleUpdateChannel = async (channelId: string, nextId: string, shortName: string) => {
    if (!mediaSource) return;
    const normalizedNextId = nextId.trim();
    if (!normalizedNextId) {
      setError("Channel number is required");
      return;
    }

    setSaving(channelId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/channels?source=${mediaSource}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: channelId,
          newId: normalizedNextId,
          shortName: shortName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setChannels(data.channels || []);
      setMessage(
        normalizedNextId !== channelId
          ? `Channel "${channelId}" renamed to "${normalizedNextId}"`
          : `Channel "${channelId}" updated`
      );
      setEditModal({ show: false, channel: null });
      setEditId("");
      setEditShortName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(null);
    }
  };

  // Delete channel
  const handleDelete = async (channelId: string) => {
    if (!mediaSource) return;
    setSaving(channelId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/channels?source=${mediaSource}&id=${encodeURIComponent(channelId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setChannels(data.channels || []);
      setMessage(`Channel "${channelId}" deleted`);
      setDeleteModal({ show: false, channel: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setSaving(null);
    }
  };

  // Toggle active status
  const handleToggleStatus = async (channel: Channel) => {
    if (!mediaSource) return;
    setSaving(channel.id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/channels?source=${mediaSource}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: channel.id,
          active: !(channel.active !== false),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setChannels(data.channels || []);
      const newStatus = data.channel?.active !== false ? "Active" : "Inactive";
      setMessage(`Channel "${channel.id}" is now ${newStatus}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle status");
    } finally {
      setSaving(null);
    }
  };

  const openEditModal = (channel: Channel) => {
    setEditModal({ show: true, channel });
    setEditId(channel.id);
    setEditShortName(channel.shortName ?? "");
  };

  // Reset all channels
  const handleResetAll = async () => {
    if (!mediaSource) return;
    setResetting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/channels/reset?source=${mediaSource}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset channels");
      
      // Clear the channels list immediately
      setChannels([]);
      setMessage(`All ${mediaSource} channels and schedules have been deleted`);
      setResetModal(false);
      
      // Force a refresh with cache-busting to ensure any caches are cleared
      await loadChannels(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset channels");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">Channels</h1>
          <p className="text-sm text-neutral-400">
            Create and manage channels
          </p>
        </div>
        {mediaSource && (
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
            mediaSource === "remote" ? "bg-blue-500/20 text-blue-200" : "bg-emerald-500/20 text-emerald-200"
          }`}>
            {mediaSource === "remote" ? "Remote" : "Local"}
          </div>
        )}
      </div>

      {/* Create Channel */}
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
          onClick={() => void loadChannels()}
          disabled={loading}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          onClick={() => setResetModal(true)}
          disabled={loading || channels.length === 0}
          className="rounded-md border border-red-400/50 bg-red-500/20 px-3 py-2 font-semibold text-red-100 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
        >
          Reset Channels
        </button>
      </div>

      {/* Channels List */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 shadow-lg shadow-black/30">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-100">Channels</h3>
          <span className="text-xs text-neutral-400">
            {channels.length} channel{channels.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            <div className="w-4 h-4 border-2 border-neutral-400 border-t-emerald-400 rounded-full animate-spin" />
            <span>Loading…</span>
          </div>
        ) : channels.length === 0 ? (
          <p className="text-sm text-neutral-400">
            No channels yet. Create one above to get started.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-neutral-200">
                <tr>
                  <th className="w-24 px-3 py-2 text-left font-semibold">Number</th>
                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                  <th className="w-24 px-3 py-2 text-left font-semibold">Status</th>
                  <th className="w-48 px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/50">
                {channels.map((channel) => (
                  <tr key={channel.id} className="text-neutral-100">
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-200">
                        {channel.id}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {channel.shortName ? (
                        <span className="text-sm text-neutral-100">{channel.shortName}</span>
                      ) : (
                        <span className="text-xs text-neutral-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleToggleStatus(channel)}
                        disabled={saving === channel.id}
                        className={`rounded-full px-2 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                          channel.active !== false
                            ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                            : "bg-neutral-500/20 text-neutral-400 hover:bg-neutral-500/30"
                        }`}
                      >
                        {channel.active !== false ? "Active" : "Inactive"}
                      </button>
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
                          onClick={() => openEditModal(channel)}
                          disabled={saving === channel.id}
                          className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteModal({ show: true, channel })}
                          disabled={saving === channel.id}
                          className="rounded-md border border-red-400/50 bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-100 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
                        >
                          Delete
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

      {/* Edit Modal */}
      {editModal.show && editModal.channel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => setEditModal({ show: false, channel: null })}>
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-neutral-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-neutral-50 mb-4">Edit Channel</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-neutral-400 block mb-1">Channel Number</label>
                <input
                  value={editId}
                  onChange={(e) => setEditId(e.target.value)}
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-neutral-400 block mb-1">Name</label>
                <input
                  value={editShortName}
                  onChange={(e) => setEditShortName(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setEditModal({ show: false, channel: null })}
                className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUpdateChannel(editModal.channel!.id, editId, editShortName)}
                disabled={saving !== null}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal.show && deleteModal.channel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => setDeleteModal({ show: false, channel: null })}>
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-neutral-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-neutral-50 mb-2">Delete Channel?</h3>
            <p className="text-sm text-neutral-300 mb-4">
              Delete channel <span className="font-semibold">{deleteModal.channel.id}</span>
              {deleteModal.channel.shortName && <span className="text-neutral-400"> ({deleteModal.channel.shortName})</span>}?
            </p>
            
            <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 mb-4">
              <p className="text-xs text-red-300">This will also delete all schedule items for this channel. This cannot be undone.</p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteModal({ show: false, channel: null })}
                className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteModal.channel!.id)}
                disabled={saving !== null}
                className="rounded-md border border-red-400/50 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 disabled:opacity-50"
              >
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset All Channels Modal */}
      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => !resetting && setResetModal(false)}>
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-neutral-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-neutral-50 mb-2">Reset All Channels?</h3>
            <p className="text-sm text-neutral-300 mb-4">
              This will delete <span className="font-semibold">all {channels.length} channel{channels.length === 1 ? "" : "s"}</span> and their schedules from the <span className={`font-semibold ${mediaSource === "remote" ? "text-blue-300" : "text-emerald-300"}`}>{mediaSource || "unknown"}</span> source.
            </p>
            
            <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 mb-4">
              <p className="text-xs text-red-300 font-semibold mb-1">⚠️ This cannot be undone!</p>
              <p className="text-xs text-red-300">All channels and their schedule data will be permanently deleted. All caches will be cleared.</p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setResetModal(false)}
                disabled={resetting}
                className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleResetAll}
                disabled={resetting}
                className="rounded-md border border-red-400/50 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 disabled:opacity-50"
              >
                {resetting ? "Deleting…" : "Delete All Channels"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
