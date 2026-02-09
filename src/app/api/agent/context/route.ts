import { NextRequest, NextResponse } from "next/server";
import {
  listChannels,
  loadFullSchedule,
  getNowPlaying,
  getScheduleItems,
  type ChannelInfo,
  type NowPlaying,
} from "@/lib/media";
import type { MediaSource } from "@/constants/media";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import type { ChannelSchedule, PlaylistItem, ScheduleSlot } from "@/lib/schedule";

export const runtime = "nodejs";

type MediaFileInfo = {
  relPath: string;
  durationSeconds: number;
  format: string;
  audioCodec?: string;
  videoCodec?: string;
  supported: boolean;
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

type AgentContext = {
  currentTime: string;
  currentTimeMs: number;
  timezone: string;
  source: MediaSource;
  mediaFiles: MediaFileInfo[];
  mediaFilesTotal: number;
  totalMediaDurationSeconds: number;
  channels: ChannelContext[];
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

    const result: AgentContext = {
      currentTime,
      currentTimeMs: now,
      timezone,
      source,
      mediaFiles,
      mediaFilesTotal: mediaFiles.length,
      totalMediaDurationSeconds,
      channels,
      formattedContext,
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load context";
    console.error("[Agent Context] Error:", message, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
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

  // List media files (limit to avoid token overflow)
  const maxFiles = 150;
  const limitedFiles = data.mediaFiles.slice(0, maxFiles);
  if (limitedFiles.length > 0) {
    const fileList = limitedFiles
      .map((f) => {
        const dur = formatDuration(f.durationSeconds);
        const codec = [f.videoCodec, f.audioCodec].filter(Boolean).join("/") || "unknown";
        return `- ${f.relPath} (${dur}, ${f.format || "?"}, ${codec})`;
      })
      .join("\n");
    parts.push(`### File List\n${fileList}`);
    if (data.mediaFiles.length > maxFiles) {
      parts.push(`... and ${data.mediaFiles.length - maxFiles} more files not shown.`);
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

      // Schedule details
      if (ch.type === "looping" && ch.schedule.playlist && ch.schedule.playlist.length > 0) {
        const playlistLines = ch.schedule.playlist
          .map((item, i) => `  ${i + 1}. ${item.title || item.file} (${formatDuration(item.durationSeconds)})`)
          .join("\n");
        chSection += `\n- Playlist:\n${playlistLines}`;
        if (ch.schedule.epochOffsetHours) {
          chSection += `\n- Epoch offset: ${ch.schedule.epochOffsetHours} hours`;
        }
      } else if (ch.type === "24hour" && ch.schedule.slots && ch.schedule.slots.length > 0) {
        const slotLines = ch.schedule.slots
          .map((slot) => `  ${slot.start}-${slot.end}: ${slot.title || slot.file}`)
          .join("\n");
        chSection += `\n- Time Slots:\n${slotLines}`;
      }

      parts.push(chSection);
    }
  }

  return parts.join("\n\n");
}
