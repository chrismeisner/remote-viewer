"use client";

import { useEffect, useState, useCallback } from "react";
import { MEDIA_SOURCE_KEY, type MediaSource } from "@/constants/media";

type ChangelogCategory = "addition" | "update" | "removal" | "note";

type ChangelogEntry = {
  id: string;
  date: string;
  message: string;
  category: ChangelogCategory;
};

const CATEGORY_CONFIG: Record<
  ChangelogCategory,
  { label: string; icon: string; bgColor: string; textColor: string; borderColor: string }
> = {
  addition: {
    label: "Addition",
    icon: "+",
    bgColor: "bg-emerald-500/20",
    textColor: "text-emerald-300",
    borderColor: "border-emerald-500/30",
  },
  update: {
    label: "Update",
    icon: "↻",
    bgColor: "bg-blue-500/20",
    textColor: "text-blue-300",
    borderColor: "border-blue-500/30",
  },
  removal: {
    label: "Removal",
    icon: "−",
    bgColor: "bg-red-500/20",
    textColor: "text-red-300",
    borderColor: "border-red-500/30",
  },
  note: {
    label: "Note",
    icon: "•",
    bgColor: "bg-neutral-500/20",
    textColor: "text-neutral-300",
    borderColor: "border-neutral-500/30",
  },
};

export default function ChangelogPage() {
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);

  // Form state
  const [newMessage, setNewMessage] = useState("");
  const [newCategory, setNewCategory] = useState<ChangelogCategory>("addition");
  const [newDate, setNewDate] = useState(() => {
    // Default to today's date in local timezone
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load media source from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
    if (stored === "local" || stored === "remote") {
      setMediaSource(stored);
    }
  }, []);

  // Fetch changelog entries
  const fetchChangelog = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/changelog?source=${mediaSource}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load changelog");
      }

      setEntries(data.changelog?.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load changelog");
    } finally {
      setLoading(false);
    }
  }, [mediaSource]);

  useEffect(() => {
    fetchChangelog();
  }, [fetchChangelog]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newMessage.trim()) {
      setSubmitError("Please enter a message");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/changelog?source=${mediaSource}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: newMessage.trim(),
          category: newCategory,
          date: new Date(newDate).toISOString(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to add entry");
      }

      // Reset form and refresh
      setNewMessage("");
      setNewCategory("addition");
      setNewDate(new Date().toISOString().split("T")[0]);
      await fetchChangelog();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to add entry");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this changelog entry?")) return;

    try {
      const res = await fetch(
        `/api/changelog?source=${mediaSource}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete entry");
      }

      await fetchChangelog();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete entry");
    }
  };

  // Format date for display
  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Group entries by month/year
  const groupedEntries = entries.reduce(
    (groups, entry) => {
      const date = new Date(entry.date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const label = date.toLocaleDateString("en-US", { year: "numeric", month: "long" });

      if (!groups[key]) {
        groups[key] = { label, entries: [] };
      }
      groups[key].entries.push(entry);
      return groups;
    },
    {} as Record<string, { label: string; entries: ChangelogEntry[] }>
  );

  const sortedGroups = Object.entries(groupedEntries).sort(([a], [b]) => b.localeCompare(a));

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Changelog</h1>
        <p className="text-neutral-400">Loading changelog...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Changelog</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Track changes to your media library
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Source:</span>
          <span
            className={`text-xs font-medium px-2 py-1 rounded ${
              mediaSource === "local"
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-blue-500/20 text-blue-300"
            }`}
          >
            {mediaSource === "local" ? "Local" : "Remote"}
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-red-300">{error}</p>
          <button
            onClick={fetchChangelog}
            className="mt-2 text-sm text-red-200 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Add Entry Form */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/30">
        <h2 className="text-sm font-semibold text-neutral-100 mb-4">Add Entry</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Category */}
            <div className="sm:w-36">
              <label className="block text-xs text-neutral-500 mb-1.5">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as ChangelogCategory)}
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400/50"
              >
                <option value="addition">Addition</option>
                <option value="update">Update</option>
                <option value="removal">Removal</option>
                <option value="note">Note</option>
              </select>
            </div>

            {/* Date */}
            <div className="sm:w-40">
              <label className="block text-xs text-neutral-500 mb-1.5">Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400/50"
              />
            </div>

            {/* Message */}
            <div className="flex-1">
              <label className="block text-xs text-neutral-500 mb-1.5">Message</label>
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="e.g., Added Season 3 of Viva La Bam"
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-400/50"
              />
            </div>
          </div>

          {submitError && (
            <p className="text-xs text-red-300 bg-red-500/10 px-3 py-2 rounded">
              {submitError}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !newMessage.trim()}
              className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Adding..." : "Add Entry"}
            </button>
          </div>
        </form>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Entries" value={entries.length} />
        <StatCard
          label="Additions"
          value={entries.filter((e) => e.category === "addition").length}
          color="emerald"
        />
        <StatCard
          label="Updates"
          value={entries.filter((e) => e.category === "update").length}
          color="blue"
        />
        <StatCard
          label="Removals"
          value={entries.filter((e) => e.category === "removal").length}
          color="red"
        />
      </div>

      {/* Entries List */}
      <div className="space-y-6">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center">
            <p className="text-neutral-400">No changelog entries yet</p>
            <p className="text-xs text-neutral-500 mt-1">
              Add your first entry above to start tracking changes
            </p>
          </div>
        ) : (
          sortedGroups.map(([key, group]) => (
            <div key={key}>
              <h3 className="text-sm font-semibold text-neutral-400 mb-3 sticky top-0 bg-black/80 backdrop-blur py-2 -mx-2 px-2">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.entries.map((entry) => {
                  const config = CATEGORY_CONFIG[entry.category];
                  return (
                    <div
                      key={entry.id}
                      className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-4 group`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <span
                            className={`flex-shrink-0 w-6 h-6 rounded-full ${config.bgColor} ${config.textColor} flex items-center justify-center text-sm font-bold`}
                          >
                            {config.icon}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm text-neutral-100">{entry.message}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-neutral-500">
                                {formatDate(entry.date)}
                              </span>
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded ${config.bgColor} ${config.textColor}`}
                              >
                                {config.label}
                              </span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="flex-shrink-0 text-neutral-600 hover:text-red-400 transition opacity-0 group-hover:opacity-100"
                          title="Delete entry"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "neutral",
}: {
  label: string;
  value: number;
  color?: "neutral" | "emerald" | "blue" | "red";
}) {
  const colorClasses = {
    neutral: "text-neutral-200",
    emerald: "text-emerald-300",
    blue: "text-blue-300",
    red: "text-red-300",
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}
