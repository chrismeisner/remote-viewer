import { Metadata } from "next";
import WatchClient from "./WatchClient";
import { REMOTE_MEDIA_BASE } from "@/constants/media";
import { getMediaItemMetadataBySource } from "@/lib/media";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "https://www.remoteviewer.tv";

// Build cover image URL from metadata
function buildCoverImageUrl(
  metadata: {
    coverUrl?: string | null;
    coverLocal?: string | null;
    coverPath?: string | null;
  } | null,
): string | null {
  if (!metadata) return null;
  if (metadata.coverUrl) return metadata.coverUrl;
  if (metadata.coverLocal) {
    return `${REMOTE_MEDIA_BASE}covers/${encodeURIComponent(metadata.coverLocal)}`;
  }
  if (metadata.coverPath) {
    return `${BASE_URL}/api/local-image?path=${encodeURIComponent(metadata.coverPath)}`;
  }
  return null;
}

type Props = {
  searchParams: Promise<{ file?: string; source?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const filePath = params.file;

  const defaultMetadata: Metadata = {
    title: "Watch | Remote Viewer",
    description: "On-demand playback for your video library",
    openGraph: {
      title: "Watch | Remote Viewer",
      description: "On-demand playback for your video library",
      url: `${BASE_URL}/watch`,
      siteName: "Remote Viewer",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Watch | Remote Viewer",
      description: "On-demand playback for your video library",
      images: ["/og-image.png"],
    },
  };

  if (!filePath) return defaultMetadata;

  // Fetch media metadata for the file
  const source = params.source === "local" ? "local" : "remote";
  let mediaTitle: string | null = null;
  let coverImageUrl: string | null = null;

  try {
    const metadata = await getMediaItemMetadataBySource(filePath, source);
    mediaTitle = metadata?.title || filePath.split("/").pop() || null;
    coverImageUrl = buildCoverImageUrl(metadata);
  } catch {
    mediaTitle = filePath.split("/").pop() || null;
  }

  const title = mediaTitle
    ? `${mediaTitle} | Remote Viewer`
    : "Watch | Remote Viewer";
  const description = mediaTitle
    ? `Watch: ${mediaTitle}`
    : "On-demand playback for your video library";
  const ogImage = coverImageUrl || `${BASE_URL}/og-image.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/watch?file=${encodeURIComponent(filePath)}`,
      siteName: "Remote Viewer",
      images: [
        {
          url: ogImage,
          width: coverImageUrl ? 600 : 1200,
          height: coverImageUrl ? 900 : 630,
          alt: mediaTitle ? `Watch: ${mediaTitle}` : "Remote Viewer",
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

export default async function WatchPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <WatchClient initialFile={params.file} initialSource={params.source} />
  );
}
