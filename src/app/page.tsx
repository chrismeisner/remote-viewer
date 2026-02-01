"use client";

import { useEffect, useState, useMemo } from "react";

type CoverFile = {
  filename: string;
  url: string;
};

export default function CoverFlowPage() {
  const [covers, setCovers] = useState<CoverFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // Hide header on mount, restore on unmount
  useEffect(() => {
    document.body.classList.add("header-hidden");
    return () => {
      document.body.classList.remove("header-hidden");
    };
  }, []);

  // Auto-hide controls after inactivity
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    
    const handleActivity = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 3000);
    };

    handleActivity(); // Start the timer
    
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("touchstart", handleActivity);
    window.addEventListener("keydown", handleActivity);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      window.removeEventListener("keydown", handleActivity);
    };
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        setIsPaused((p) => !p);
      } else if (e.key === "Escape" || e.key === "Enter") {
        // Go to player
        window.location.href = "/player";
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch covers that are actually linked to media items
  useEffect(() => {
    const fetchCovers = async () => {
      try {
        // Fetch remote covers and metadata (both local and remote sources) in parallel
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
        const localMetadata: Record<string, { coverLocal?: string; coverUrl?: string }> = localMetadataData.items || {};
        const remoteMetadata: Record<string, { coverLocal?: string; coverUrl?: string }> = remoteMetadataData.items || {};
        
        // Build set of covers that are actually in use by media items (from both sources)
        const usedCoverFilenames = new Set<string>();
        const usedCoverUrls = new Set<string>();
        
        // Collect from local metadata
        for (const item of Object.values(localMetadata)) {
          if (item.coverLocal) {
            usedCoverFilenames.add(item.coverLocal);
          }
          if (item.coverUrl) {
            usedCoverUrls.add(item.coverUrl);
          }
        }
        
        // Collect from remote metadata
        for (const item of Object.values(remoteMetadata)) {
          if (item.coverLocal) {
            usedCoverFilenames.add(item.coverLocal);
          }
          if (item.coverUrl) {
            usedCoverUrls.add(item.coverUrl);
          }
        }
        
        // Filter covers to only those that are referenced in metadata
        const activeCovers = allCovers.filter((cover) => {
          // Check if filename matches a coverLocal reference
          if (usedCoverFilenames.has(cover.filename)) {
            return true;
          }
          // Check if URL matches a coverUrl reference
          if (usedCoverUrls.has(cover.url)) {
            return true;
          }
          return false;
        });
        
        // Also add any URL-based covers from metadata that aren't in the covers folder
        const urlCovers: CoverFile[] = [];
        for (const coverUrl of usedCoverUrls) {
          // Check if this URL is already in activeCovers
          const alreadyIncluded = activeCovers.some((c) => c.url === coverUrl);
          if (!alreadyIncluded) {
            urlCovers.push({
              filename: coverUrl,
              url: coverUrl,
            });
          }
        }
        
        let finalCovers = [...activeCovers, ...urlCovers];
        
        // Fallback: if no covers found after filtering but remote covers exist,
        // use all remote covers (metadata might not be set up yet)
        if (finalCovers.length === 0 && allCovers.length > 0) {
          console.log("[CoverFlow] No linked covers found, using all available covers");
          finalCovers = allCovers;
        }

        if (finalCovers.length === 0) {
          setError("No covers found in your media library");
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

  // Generate column data with intelligent distribution to minimize duplicates
  const columns = useMemo(() => {
    if (covers.length === 0) return [];

    const numColumns = 8;
    
    // Shuffle the master list once
    const shuffled = [...covers].sort(() => Math.random() - 0.5);
    
    // Calculate how many covers we need per column (estimate ~6 visible at once per column)
    const coversPerColumn = Math.max(12, Math.ceil(covers.length / numColumns) * 2);
    
    // Distribute covers across columns using round-robin to minimize duplicates
    const columnCovers: CoverFile[][] = Array.from({ length: numColumns }, () => []);
    
    // First pass: distribute unique covers round-robin style
    shuffled.forEach((cover, index) => {
      const columnIndex = index % numColumns;
      columnCovers[columnIndex].push(cover);
    });
    
    // Second pass: fill columns that need more covers, avoiding adjacent duplicates
    const columnData: { covers: CoverFile[]; speed: number; reverse: boolean; offset: number }[] = [];
    
    for (let i = 0; i < numColumns; i++) {
      let colCovers = [...columnCovers[i]];
      
      // If column doesn't have enough covers, add more from other columns' unused covers
      // or from the shuffled list with different ordering
      if (colCovers.length < coversPerColumn) {
        // Create a pool of covers not yet in this column
        const usedInColumn = new Set(colCovers.map(c => c.filename));
        const availableCovers = shuffled.filter(c => !usedInColumn.has(c.filename));
        
        // Add available covers first
        for (const cover of availableCovers) {
          if (colCovers.length >= coversPerColumn) break;
          colCovers.push(cover);
        }
        
        // If still not enough, we need to repeat - but shuffle differently
        while (colCovers.length < coversPerColumn) {
          // Shuffle again and add, but offset by column index to create variety
          const reshuffled = [...shuffled].sort(() => Math.random() - 0.5);
          const offset = (i * 3) % reshuffled.length;
          const rotated = [...reshuffled.slice(offset), ...reshuffled.slice(0, offset)];
          
          for (const cover of rotated) {
            if (colCovers.length >= coversPerColumn) break;
            // Avoid putting same cover adjacent to itself
            if (colCovers.length > 0 && colCovers[colCovers.length - 1].filename === cover.filename) {
              continue;
            }
            colCovers.push(cover);
          }
        }
      }
      
      // Shuffle this column's covers for additional randomness
      colCovers = colCovers.sort(() => Math.random() - 0.5);
      
      // Ensure no adjacent duplicates after shuffle
      for (let j = 1; j < colCovers.length; j++) {
        if (colCovers[j].filename === colCovers[j - 1].filename) {
          // Find a non-duplicate to swap with
          for (let k = j + 1; k < colCovers.length; k++) {
            if (colCovers[k].filename !== colCovers[j - 1].filename) {
              [colCovers[j], colCovers[k]] = [colCovers[k], colCovers[j]];
              break;
            }
          }
        }
      }
      
      // Triple the covers for seamless infinite scroll
      const repeated = [...colCovers, ...colCovers, ...colCovers];
      
      // Different starting offset for each column (percentage of scroll)
      const startOffset = (i * 13.7) % 33.333; // Prime-ish number for variety
      
      columnData.push({
        covers: repeated,
        speed: 1500 + Math.random() * 1000, // 25-40 minutes
        reverse: i % 2 === 1,
        offset: startOffset,
      });
    }

    return columnData;
  }, [covers]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-neutral-600 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-neutral-400 text-sm">Loading covers...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-neutral-300 mb-2">{error}</p>
          <p className="text-neutral-500 text-sm mb-6">
            Add cover images to your media library to use Cover Flow
          </p>
          <div className="flex flex-col gap-3">
            <a
              href="/player"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-sm font-semibold text-black transition"
            >
              Go to Player
            </a>
            <a
              href="/admin/covers"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-neutral-200 transition"
            >
              Manage Covers
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Cover Flow Grid */}
      <div className="absolute inset-0 flex gap-2 sm:gap-3 p-2 sm:p-3">
        {columns.map((column, colIndex) => (
          <div
            key={colIndex}
            className="flex-1 overflow-hidden relative"
            style={{ minWidth: 0 }}
          >
            <div
              className={`flex flex-col gap-2 sm:gap-3 ${isPaused ? "" : "animate-scroll"}`}
              style={{
                animationDuration: `${column.speed}s`,
                animationDirection: column.reverse ? "reverse" : "normal",
                animationPlayState: isPaused ? "paused" : "running",
                animationDelay: `-${(column.offset / 33.333) * column.speed}s`, // Start at different positions
              }}
            >
              {column.covers.map((cover, idx) => (
                <div
                  key={`${cover.filename}-${idx}`}
                  className="relative aspect-[2/3] rounded-lg overflow-hidden flex-shrink-0 bg-neutral-900"
                >
                  <img
                    src={cover.url}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      // Hide broken images
                      (e.target as HTMLImageElement).style.opacity = "0";
                    }}
                  />
                  {/* Subtle shine overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-black/20 pointer-events-none" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Gradient overlays for depth */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black via-black/50 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black via-black/50 to-transparent pointer-events-none" />

      {/* Controls overlay */}
      <div
        className={`fixed inset-x-0 bottom-0 p-6 transition-opacity duration-500 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="max-w-md mx-auto flex items-center justify-between bg-black/80 backdrop-blur-sm rounded-xl border border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <a
              href="/player"
              className="p-2 rounded-lg hover:bg-white/10 transition text-neutral-400 hover:text-white"
              title="Go to Player"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </a>
            <div className="h-6 w-px bg-white/10" />
            <div className="text-sm">
              <p className="font-medium text-white">Remote Viewer</p>
              <p className="text-xs text-neutral-500">{covers.length} covers</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="p-2 rounded-lg hover:bg-white/10 transition text-neutral-400 hover:text-white"
              title={isPaused ? "Play (Space)" : "Pause (Space)"}
            >
              {isPaused ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              )}
            </button>
          </div>
        </div>
        
        {/* Keyboard hints */}
        <div className="mt-3 flex items-center justify-center gap-4 text-xs text-neutral-600">
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono">Space</kbd>
            {" "}pause
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono">Enter</kbd>
            {" "}watch
          </span>
        </div>
      </div>

      {/* CSS for infinite scroll animation */}
      <style jsx>{`
        @keyframes scroll {
          0% {
            transform: translateY(0);
          }
          100% {
            transform: translateY(-33.333%);
          }
        }

        .animate-scroll {
          animation: scroll linear infinite;
        }

        /* Hide columns on smaller screens */
        @media (max-width: 640px) {
          .flex > div:nth-child(n+5) {
            display: none;
          }
        }

        @media (min-width: 641px) and (max-width: 1024px) {
          .flex > div:nth-child(n+7) {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
