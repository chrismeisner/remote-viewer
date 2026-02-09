import { NextRequest, NextResponse } from "next/server";
import {
  listChannels,
  loadFullSchedule,
  getNowPlaying,
  getScheduleItems,
  loadMediaMetadataBySource,
  type ChannelInfo,
  type NowPlaying,
  type MediaMetadataItem,
  type MediaMetadataStore,
} from "@/lib/media";
import type { MediaSource } from "@/constants/media";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import { parseTimeToSeconds, type ChannelSchedule, type PlaylistItem, type ScheduleSlot } from "@/lib/schedule";

export const runtime = "nodejs";

type MediaFileInfo = {
  relPath: string;
  durationSeconds: number;
  format: string;
  audioCodec?: string;
  videoCodec?: string;
  supported: boolean;
  metadata?: MediaMetadataItem;
};

type ChannelContext = {
  id: string;
  shortName?: string;
  active: boolean;
  type: "24hour" | "looping";
  scheduledCount: number;
  totalDurationSeconds: number;
  nowPlaying: NowPlaying | null;
  schedule: {
    slots?: ScheduleSlot[];
    playlist?: PlaylistItem[];
    epochOffsetHours?: number;
  };
};

type AgentContextResponse = {
  currentTime: string;
  currentTimeMs: number;
  timezone: string;
  source: MediaSource;
  mediaFilesTotal: number;
  totalMediaDurationSeconds: number;
  channels: Pick<ChannelContext, "id" | "shortName" | "active" | "type" | "scheduledCount">[];
  formattedContext: string;
};

/**
 * GET /api/agent/context?source=local|remote
 * 
 * Gathers full application state for the AI agent:
 * - Current time
 * - Media source
 * - All media files
 * - All channels with schedules
 * - Now-playing for each active channel
 */
export async function GET(request: NextRequest) {
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source: MediaSource =
    sourceParam === "remote" || sourceParam === "local" ? sourceParam : "local";

  try {
    const now = Date.now();
    const currentTime = new Date(now).toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Gather media files
    let mediaFiles: MediaFileInfo[] = [];
    try {
      if (source === "remote") {
        const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
        if (base) {
          const manifestUrl = new URL("media-index.json", base).toString();
          const res = await fetch(manifestUrl);
          if (res.ok) {
            const json = await res.json();
            mediaFiles = (json.items || []).map((f: Record<string, unknown>) => ({
              relPath: f.relPath as string,
              durationSeconds: (f.durationSeconds as number) || 0,
              format: (f.format as string) || "",
              audioCodec: f.audioCodec as string | undefined,
              videoCodec: f.videoCodec as string | undefined,
              supported: (f.supported as boolean) ?? true,
            }));
          }
        }
      } else {
        const items = await getScheduleItems();
        mediaFiles = items.map((f) => ({
          relPath: f.relPath,
          durationSeconds: f.durationSeconds,
          format: f.format || "",
          audioCodec: f.audioCodec,
          videoCodec: f.videoCodec,
          supported: f.supported,
        }));
      }
    } catch (err) {
      console.error("[Agent Context] Failed to load media files:", err);
    }

    // Gather media metadata and attach to files
    let metadataStore: MediaMetadataStore = { items: {} };
    try {
      metadataStore = await loadMediaMetadataBySource(source);
      // Attach metadata to each file
      for (const file of mediaFiles) {
        const meta = metadataStore.items[file.relPath];
        if (meta) {
          file.metadata = meta;
        }
      }
    } catch (err) {
      console.error("[Agent Context] Failed to load media metadata:", err);
    }

    // Gather channels
    let channelInfos: ChannelInfo[] = [];
    try {
      channelInfos = await listChannels(source);
    } catch (err) {
      console.error("[Agent Context] Failed to load channels:", err);
    }

    // Gather full schedule
    let fullSchedule: Record<string, ChannelSchedule> = {};
    try {
      const sched = await loadFullSchedule(source);
      fullSchedule = sched.channels || {};
    } catch (err) {
      console.error("[Agent Context] Failed to load schedule:", err);
    }

    // Gather now-playing for each active channel
    const channels: ChannelContext[] = await Promise.all(
      channelInfos.map(async (ch) => {
        let nowPlaying: NowPlaying | null = null;
        if (ch.active !== false) {
          try {
            nowPlaying = await getNowPlaying(now, ch.id, source);
          } catch {
            // Channel may have empty/invalid schedule
          }
        }

        const chSchedule = fullSchedule[ch.id] || {};

        return {
          id: ch.id,
          shortName: ch.shortName,
          active: ch.active !== false,
          type: (ch.type || "24hour") as "24hour" | "looping",
          scheduledCount: ch.scheduledCount || 0,
          totalDurationSeconds: ch.totalDurationSeconds || 0,
          nowPlaying,
          schedule: {
            slots: chSchedule.slots,
            playlist: chSchedule.playlist,
            epochOffsetHours: chSchedule.epochOffsetHours,
          },
        };
      })
    );

    // Calculate totals
    const totalMediaDurationSeconds = mediaFiles.reduce(
      (sum, f) => sum + (f.durationSeconds || 0),
      0
    );

    // Format human-readable context for the system prompt
    const formattedContext = formatContext({
      currentTime,
      timezone,
      source,
      mediaFiles,
      totalMediaDurationSeconds,
      channels,
    });

    // Return only what the client needs (formattedContext has the full library for the AI)
    const result: AgentContextResponse = {
      currentTime,
      currentTimeMs: now,
      timezone,
      source,
      mediaFilesTotal: mediaFiles.length,
      totalMediaDurationSeconds,
      channels: channels.map((ch) => ({
        id: ch.id,
        shortName: ch.shortName,
        active: ch.active,
        type: ch.type,
        scheduledCount: ch.scheduledCount,
      })),
      formattedContext,
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load context";
    console.error("[Agent Context] Error:", message, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Returns true if the metadata has at least one useful field beyond dateAdded */
function hasUsefulMetadata(m: MediaMetadataItem): boolean {
  return !!(
    m.title ||
    m.year ||
    m.director ||
    m.plot ||
    m.type ||
    m.imdbUrl ||
    (m.tags && m.tags.length > 0) ||
    m.season != null ||
    m.episode != null
  );
}

// ─── Format context as human-readable text for the AI system prompt ───

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatContext(data: {
  currentTime: string;
  timezone: string;
  source: MediaSource;
  mediaFiles: MediaFileInfo[];
  totalMediaDurationSeconds: number;
  channels: ChannelContext[];
}): string {
  const parts: string[] = [];

  // Current time
  const date = new Date(data.currentTime);
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  parts.push(`## Current Time\n${dateStr} at ${timeStr} (${data.timezone})`);

  // Source
  parts.push(`## Media Source\n${data.source === "remote" ? "Remote (FTP/CDN)" : "Local filesystem"}`);

  // Media library
  const totalDur = formatDuration(data.totalMediaDurationSeconds);
  parts.push(
    `## Media Library\n${data.mediaFiles.length} files, ${totalDur} total duration`
  );

  // List ALL media files with available metadata
  if (data.mediaFiles.length > 0) {
    const filesWithMeta = data.mediaFiles.filter((f) => f.metadata && hasUsefulMetadata(f.metadata));
    const filesWithoutMeta = data.mediaFiles.filter((f) => !f.metadata || !hasUsefulMetadata(f.metadata));

    // Files with rich metadata — include all known details
    if (filesWithMeta.length > 0) {
      const richList = filesWithMeta
        .map((f) => {
          const m = f.metadata!;
          const dur = formatDuration(f.durationSeconds);
          const parts: string[] = [`- ${f.relPath} (${dur})`];
          const details: string[] = [];
          if (m.title) details.push(`Title: ${m.title}`);
          if (m.year) details.push(`Year: ${m.year}`);
          if (m.director) details.push(`Director: ${m.director}`);
          if (m.type) details.push(`Type: ${m.type}`);
          if (m.plot) details.push(`Plot: ${m.plot}`);
          if (m.tags && m.tags.length > 0) details.push(`Tags: ${m.tags.join(", ")}`);
          if (m.imdbUrl) details.push(`IMDB: ${m.imdbUrl}`);
          if (m.season != null) details.push(`Season: ${m.season}`);
          if (m.episode != null) details.push(`Episode: ${m.episode}`);
          if (details.length > 0) {
            parts.push(`  ${details.join(" | ")}`);
          }
          return parts.join("\n");
        })
        .join("\n");
      parts.push(`### Media with Metadata (${filesWithMeta.length} files)\n${richList}`);
    }

    // Files without metadata — compact list
    if (filesWithoutMeta.length > 0) {
      const simpleList = filesWithoutMeta
        .map((f) => {
          const dur = formatDuration(f.durationSeconds);
          return `- ${f.relPath} (${dur})`;
        })
        .join("\n");
      parts.push(`### Media without Metadata (${filesWithoutMeta.length} files)\n${simpleList}`);
    }
  }

  // Channels
  if (data.channels.length === 0) {
    parts.push(`## Channels\nNo channels configured.`);
  } else {
    const activeCount = data.channels.filter((c) => c.active).length;
    parts.push(
      `## Channels\n${data.channels.length} total, ${activeCount} active`
    );

    for (const ch of data.channels) {
      const name = ch.shortName ? `${ch.shortName} (ID: ${ch.id})` : `Channel ${ch.id}`;
      const status = ch.active ? "ACTIVE" : "INACTIVE";
      const type = ch.type === "looping" ? "Looping Playlist" : "24-Hour Schedule";

      let chSection = `### ${name}\n- Status: ${status}\n- Type: ${type}\n- Scheduled items: ${ch.scheduledCount}`;

      if (ch.totalDurationSeconds > 0) {
        chSection += `\n- Total duration: ${formatDuration(ch.totalDurationSeconds)}`;
      }

      // Now Playing
      if (ch.nowPlaying) {
        const np = ch.nowPlaying;
        const remaining = Math.max(0, Math.round((np.endsAt - Date.now()) / 1000));
        chSection += `\n- NOW PLAYING: "${np.title || np.relPath}" (${formatDuration(np.durationSeconds)}, ${formatDuration(remaining)} remaining)`;
      } else if (ch.active && ch.scheduledCount > 0) {
        chSection += `\n- NOW PLAYING: Nothing currently scheduled for this time`;
      }

      // Schedule details with next-airing times
      if (ch.type === "looping" && ch.schedule.playlist && ch.schedule.playlist.length > 0) {
        const playlist = ch.schedule.playlist;
        const totalDuration = playlist.reduce((sum, item) => sum + item.durationSeconds, 0);

        if (totalDuration > 0) {
          const epochOffsetSeconds = (ch.schedule.epochOffsetHours || 0) * 3600;
          const nowSeconds = Math.floor(Date.now() / 1000);
          const adjustedSeconds = nowSeconds - epochOffsetSeconds;
          const positionInLoop = ((adjustedSeconds % totalDuration) + totalDuration) % totalDuration;

          // Calculate each item's start position in the loop and next air time
          let accumulated = 0;
          const playlistLines = playlist.map((item, i) => {
            const itemStart = accumulated;
            accumulated += item.durationSeconds;

            let secondsUntilNext: number;
            if (itemStart > positionInLoop) {
              // Coming up later in the current loop
              secondsUntilNext = itemStart - positionInLoop;
            } else if (itemStart + item.durationSeconds > positionInLoop) {
              // Currently playing — next full airing is next loop cycle
              secondsUntilNext = 0; // airing right now
            } else {
              // Already passed in this loop — next airing is in the next cycle
              secondsUntilNext = totalDuration - positionInLoop + itemStart;
            }

            const nextAirDate = new Date(Date.now() + secondsUntilNext * 1000);
            const nextAirStr = secondsUntilNext === 0
              ? "NOW"
              : nextAirDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

            return `  ${i + 1}. ${item.title || item.file} (${formatDuration(item.durationSeconds)}) — next: ${nextAirStr}`;
          }).join("\n");

          chSection += `\n- Playlist (loop cycle: ${formatDuration(totalDuration)}):\n${playlistLines}`;
        }
      } else if (ch.type === "24hour" && ch.schedule.slots && ch.schedule.slots.length > 0) {
        const nowDate = new Date();
        const currentSecondsOfDay = nowDate.getHours() * 3600 + nowDate.getMinutes() * 60 + nowDate.getSeconds();

        const slotLines = ch.schedule.slots.map((slot) => {
          const startSec = parseTimeToSeconds(slot.start);
          let nextLabel = "";
          if (startSec !== null) {
            if (startSec > currentSecondsOfDay) {
              nextLabel = " — today";
            } else {
              nextLabel = " — tomorrow";
            }
          }
          return `  ${slot.start}-${slot.end}: ${slot.title || slot.file}${nextLabel}`;
        }).join("\n");
        chSection += `\n- Time Slots:\n${slotLines}`;
      }

      parts.push(chSection);
    }
  }

  return parts.join("\n\n");
}
