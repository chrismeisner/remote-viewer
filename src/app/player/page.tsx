import { Metadata } from "next";
import PlayerClient from "./PlayerClient";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import {
  listChannels,
  getNowPlaying,
  getMediaItemMetadataBySource,
  type ChannelInfo,
} from "@/lib/media";

// Base URL for generating absolute URLs in metadata
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.remoteviewer.tv";

// Fetch channel info directly from library
async function getChannelInfo(channelId: string): Promise<ChannelInfo | null> {
  try {
    // Use remote source by default (matches player default behavior)
    const channels = await listChannels("remote");
    return channels.find((ch) => ch.id === channelId) || null;
  } catch (error) {
    console.error("[metadata] Failed to fetch channel info:", error);
    return null;
  }
}

// Fetch now playing info for a channel directly from library
async function getNowPlayingInfo(channelId: string) {
  try {
    const nowPlaying = await getNowPlaying(Date.now(), channelId, "remote");
    return nowPlaying;
  } catch (error) {
    console.error("[metadata] Failed to fetch now playing:", error);
    return null;
  }
}

// Fetch media metadata (for cover image) directly from library
async function getMediaMetadata(relPath: string) {
  try {
    const metadata = await getMediaItemMetadataBySource(relPath, "remote");
    return metadata;
  } catch (error) {
    console.error("[metadata] Failed to fetch media metadata:", error);
    return null;
  }
}

// Build cover image URL from metadata
function buildCoverImageUrl(metadata: { coverUrl?: string | null; coverLocal?: string | null; coverPath?: string | null } | null): string | null {
  if (!metadata) return null;
  
  // External URL - use directly
  if (metadata.coverUrl) return metadata.coverUrl;
  
  // Local cover file - use CDN URL for remote mode
  if (metadata.coverLocal) {
    return `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(metadata.coverLocal)}`;
  }
  
  // Local filesystem path - use API route (won't work well for social sharing from remote)
  if (metadata.coverPath) {
    return `${BASE_URL}/api/local-image?path=${encodeURIComponent(metadata.coverPath)}`;
  }
  
  return null;
}

type Props = {
  searchParams: Promise<{ channel?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const channelId = params.channel;
  
  // Default metadata (no channel specified)
  const defaultMetadata: Metadata = {
    title: "Remote Viewer",
    description: "Local channel-style playback for your video library",
    openGraph: {
      title: "Remote Viewer",
      description: "Local channel-style playback for your video library",
      url: `${BASE_URL}/player`,
      siteName: "Remote Viewer",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Remote Viewer",
      description: "Local channel-style playback for your video library",
      images: ["/og-image.png"],
    },
  };
  
  if (!channelId) {
    return defaultMetadata;
  }
  
  // Fetch channel info, now playing, and media metadata in parallel
  const [channelInfo, nowPlaying] = await Promise.all([
    getChannelInfo(channelId),
    getNowPlayingInfo(channelId),
  ]);
  
  // If channel doesn't exist, return default metadata
  if (!channelInfo) {
    return defaultMetadata;
  }
  
  // Get media metadata if we have now playing content (for title and cover image)
  let coverImageUrl: string | null = null;
  let description = "Local channel-style playback for your video library";
  let mediaTitle: string | null = null;
  
  if (nowPlaying) {
    const mediaMetadata = await getMediaMetadata(nowPlaying.relPath);
    coverImageUrl = buildCoverImageUrl(mediaMetadata);
    
    // Use metadata title if available, otherwise fall back to nowPlaying title or filename
    mediaTitle = mediaMetadata?.title || nowPlaying.title || nowPlaying.relPath.split("/").pop() || "Unknown";
    description = `Now playing: ${mediaTitle}`;
  }
  
  // Build title: "Remote Viewer | 03 • The Matrix" format
  const channelNumber = channelId.padStart(2, "0");
  const title = mediaTitle
    ? `Remote Viewer | ${channelNumber} • ${mediaTitle}`
    : `Remote Viewer | ${channelNumber}`;
  
  // Use cover image if available, otherwise fallback to default OG image
  const ogImage = coverImageUrl || `${BASE_URL}/og-image.png`;
  
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/player?channel=${channelId}`,
      siteName: "Remote Viewer",
      images: [
        {
          url: ogImage,
          width: coverImageUrl ? 600 : 1200, // Cover images are typically portrait
          height: coverImageUrl ? 900 : 630,
          alt: coverImageUrl ? `Now playing on Channel ${channelNumber}` : "Remote Viewer",
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PlayerPage({ searchParams }: Props) {
  const params = await searchParams;
  const channelId = params.channel;
  
  return <PlayerClient initialChannel={channelId} />;
}
