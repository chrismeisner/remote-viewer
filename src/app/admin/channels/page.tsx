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
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
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
  const [orphanedSchedules, setOrphanedSchedules] = useState<string[]>([]);
  const [cleaningUp, setCleaningUp] = useState(false);

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

      // Also check for orphaned schedules
      void checkOrphanedSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [apiBase, mediaSource]);

  // Check for orphaned schedules
  const checkOrphanedSchedules = async () => {
    try {
      const res = await fetch("/api/schedule/cleanup");
      if (res.ok) {
        const data = await res.json();
        setOrphanedSchedules(data.orphanedChannels || []);
      }
    } catch {
      // Ignore errors in checking orphans
    }
  };

  // Clean up orphaned schedules
  const cleanupOrphanedSchedules = async () => {
    setCleaningUp(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/schedule/cleanup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cleanup failed");
      setMessage(data.message);
      setOrphanedSchedules([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setCleaningUp(false);
    }
  };

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

  // Update channel id and shortName
  const handleUpdateChannel = async (channelId: string, nextId: string, shortName: string) => {
    const normalizedNextId = nextId.trim();
    if (!normalizedNextId) {
      setError("Channel number is required");
      return;
    }

    setSaving(channelId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(apiBase, {
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
      setChannels(data.channels);

      const renamed = normalizedNextId !== channelId;
      setMessage(
        renamed
          ? `Channel "${channelId}" renamed to "${normalizedNextId}"`
          : `Channel "${channelId}" updated`,
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
      setMessage(`Channel "${channelId}" and its schedule deleted`);
      setDeleteModal({ show: false, channel: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setSaving(null);
    }
  };

  // Toggle channel active status
  const handleToggleStatus = async (channel: Channel) => {
    setSaving(channel.id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: channel.id,
          active: !(channel.active !== false), // Toggle: treat undefined as true
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setChannels(data.channels);
      const newStatus = data.channel?.active !== false ? "Active" : "Inactive";
      setMessage(`Channel "${channel.id}" is now ${newStatus}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle status");
    } finally {
      setSaving(null);
    }
  };

  const openDeleteModal = (channel: Channel) => {
    setDeleteModal({ show: true, channel });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ show: false, channel: null });
  };

  const openEditModal = (channel: Channel) => {
    setEditModal({ show: true, channel });
    setEditId(channel.id);
    setEditShortName(channel.shortName ?? "");
  };

  const closeEditModal = () => {
    setEditModal({ show: false, channel: null });
    setEditId("");
    setEditShortName("");
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

      {/* Orphaned Schedules Warning */}
      {!isRemote && orphanedSchedules.length > 0 && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-semibold text-amber-100">⚠️ Orphaned Schedules Detected</p>
              <p className="mt-1 text-xs text-amber-200">
                Found {orphanedSchedules.length} schedule(s) for deleted channels:{" "}
                <span className="font-mono">{orphanedSchedules.join(", ")}</span>
              </p>
              <p className="mt-2 text-xs text-amber-300">
                These schedules exist in <code className="bg-amber-500/20 px-1 rounded">schedule.json</code> but 
                their channels no longer exist in <code className="bg-amber-500/20 px-1 rounded">channels.json</code>.
              </p>
            </div>
            <button
              onClick={() => void cleanupOrphanedSchedules()}
              disabled={cleaningUp}
              className="rounded-md border border-amber-300/50 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:border-amber-200 hover:bg-amber-500/30 disabled:opacity-50 whitespace-nowrap"
            >
              {cleaningUp ? "Cleaning…" : "Clean Up"}
            </button>
          </div>
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
                ? "Stored in schedule.json on remote CDN (persistent)"
                : "Stored in local schedule.json (not persistent on cloud platforms)"}
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
                  <th className="w-24 px-3 py-2 text-left font-semibold">Status</th>
                  <th className="w-48 px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/50">
                {channels.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    saving={saving === channel.id}
                    onEdit={() => openEditModal(channel)}
                    onDelete={() => openDeleteModal(channel)}
                    onToggleStatus={() => handleToggleStatus(channel)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-amber-300">{error}</p>}

      {/* Edit Channel Modal */}
      {editModal.show && editModal.channel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={closeEditModal}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/15 bg-neutral-900 p-6 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-neutral-50">Edit Channel</h3>
              <p className="mt-2 text-sm text-neutral-300">
                Update the channel number and short name. Renaming the number will also move any
                existing schedule entries to the new number.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-300">Channel number</label>
                <input
                  value={editId}
                  onChange={(e) => setEditId(e.target.value)}
                  placeholder="e.g., 1"
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-300">Short name</label>
                <input
                  value={editShortName}
                  onChange={(e) => setEditShortName(e.target.value)}
                  placeholder="Optional short label"
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeEditModal}
                className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  editModal.channel &&
                  handleUpdateChannel(editModal.channel.id, editId, editShortName)
                }
                disabled={saving !== null}
                className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {saving === editModal.channel.id ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.show && deleteModal.channel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={closeDeleteModal}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/15 bg-neutral-900 p-6 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-neutral-50">Delete Channel?</h3>
              <p className="mt-2 text-sm text-neutral-300">
                Are you sure you want to delete channel{" "}
                <span className="font-semibold text-neutral-100">
                  {deleteModal.channel.id}
                </span>
                {deleteModal.channel.shortName && (
                  <span className="text-neutral-400"> ({deleteModal.channel.shortName})</span>
                )}
                ?
              </p>
              <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 p-3">
                <p className="text-sm font-semibold text-red-200">⚠️ Warning</p>
                <p className="mt-1 text-xs text-red-300">
                  This will permanently delete:
                </p>
                <ul className="mt-2 ml-4 space-y-1 text-xs text-red-300 list-disc">
                  <li>The channel configuration</li>
                  <li>All schedule items for this channel</li>
                </ul>
                <p className="mt-2 text-xs text-red-200 font-semibold">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={closeDeleteModal}
                className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteModal.channel && handleDelete(deleteModal.channel.id)}
                disabled={saving !== null}
                className="rounded-md border border-red-400/50 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 transition hover:border-red-300 hover:bg-red-500/30 disabled:opacity-50"
              >
                {saving === deleteModal.channel.id ? "Deleting…" : "Delete Channel & Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Individual row component to manage local edit state
function ChannelRow({
  channel,
  saving,
  onEdit,
  onDelete,
  onToggleStatus,
}: {
  channel: Channel;
  saving: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
}) {
  const isActive = channel.active !== false; // Treat undefined as active

  return (
    <tr className="text-neutral-100">
      <td className="px-3 py-2">
        <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-200">
          {channel.id}
        </span>
      </td>
      <td className="px-3 py-2">
        {channel.shortName ? (
          <span className="rounded-md bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-50">
            {channel.shortName}
          </span>
        ) : (
          <span className="text-xs text-neutral-500">Not set</span>
        )}
      </td>
      <td className="px-3 py-2">
        <button
          onClick={onToggleStatus}
          disabled={saving}
          className={`rounded-full px-2 py-1 text-xs font-semibold transition disabled:opacity-50 ${
            isActive
              ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
              : "bg-neutral-500/20 text-neutral-400 hover:bg-neutral-500/30"
          }`}
        >
          {isActive ? "Active" : "Inactive"}
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
            onClick={onEdit}
            disabled={saving}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-100 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
          >
            Edit
          </button>
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
