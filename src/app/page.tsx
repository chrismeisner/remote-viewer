"use client";

import { useEffect, useState } from "react";

type CoverFile = {
  filename: string;
  url: string;
};

export default function CoverFlowPage() {
  const [covers, setCovers] = useState<CoverFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hide header on mount
  useEffect(() => {
    document.body.classList.add("header-hidden");
    return () => document.body.classList.remove("header-hidden");
  }, []);

  // Fetch covers
  useEffect(() => {
    const fetchCovers = async () => {
      try {
        const [remoteCoversRes, localMetadataRes, remoteMetadataRes] = await Promise.all([
          fetch("/api/covers?source=remote"),
          fetch("/api/media-metadata?source=local"),
          fetch("/api/media-metadata?source=remote"),
        ]);
        
        const [remoteCoversData, localMetadataData, remoteMetadataData] = await Promise.all([
          remoteCoversRes.json(),
          localMetadataRes.json(),
          remoteMetadataRes.json(),
        ]);
        
        const allCovers: CoverFile[] = remoteCoversData.covers || [];
        type MetadataItem = { coverLocal?: string; coverUrl?: string };
        const localMetadata: Record<string, MetadataItem> = localMetadataData.items || {};
        const remoteMetadata: Record<string, MetadataItem> = remoteMetadataData.items || {};
        
        const usedCoverFilenames = new Set<string>();
        const usedCoverUrls = new Set<string>();
        
        const processMetadata = (items: Record<string, MetadataItem>) => {
          for (const item of Object.values(items)) {
            if (item.coverLocal) usedCoverFilenames.add(item.coverLocal);
            if (item.coverUrl) usedCoverUrls.add(item.coverUrl);
          }
        };
        
        processMetadata(localMetadata);
        processMetadata(remoteMetadata);
        
        const activeCovers = allCovers.filter((cover) => 
          usedCoverFilenames.has(cover.filename) || usedCoverUrls.has(cover.url)
        );
        
        const urlCovers: CoverFile[] = [];
        for (const coverUrl of usedCoverUrls) {
          if (!activeCovers.some((c) => c.url === coverUrl)) {
            urlCovers.push({ filename: coverUrl, url: coverUrl });
          }
        }
        
        let finalCovers = [...activeCovers, ...urlCovers];
        
        if (finalCovers.length === 0 && allCovers.length > 0) {
          finalCovers = allCovers;
        }

        if (finalCovers.length === 0) {
          setError("No covers found");
        } else {
          setCovers(finalCovers);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load covers");
      } finally {
        setLoading(false);
      }
    };

    fetchCovers();
  }, []);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-neutral-700 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <p className="text-neutral-300 mb-6">{error}</p>
          <a
            href="/player"
            className="inline-flex items-center justify-center rounded-md bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-sm font-semibold text-black transition"
          >
            Go to Player
          </a>
        </div>
      </div>
    );
  }

  // Distribute covers across columns
  const numColumns = 6;
  const columns: CoverFile[][] = Array.from({ length: numColumns }, () => []);
  covers.forEach((cover, idx) => {
    columns[idx % numColumns].push(cover);
  });

  return (
    <div className="fixed inset-0 bg-black overflow-y-auto">
      <div className="flex gap-3 p-3 min-h-full">
        {columns.map((column, colIndex) => (
          <div key={colIndex} className="flex-1 flex flex-col gap-3">
            {column.map((cover) => (
              <div
                key={cover.filename}
                className="relative aspect-[2/3] rounded-lg overflow-hidden bg-neutral-900"
              >
                <img
                  src={cover.url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Branding */}
      <div className="fixed inset-x-0 bottom-0 p-6 pointer-events-none">
        <div className="max-w-md mx-auto flex items-center justify-center bg-black/80 backdrop-blur-sm rounded-xl border border-white/10 px-6 py-4">
          <p className="font-homevideo text-2xl text-white">Remote Viewer</p>
        </div>
      </div>
    </div>
  );
}
