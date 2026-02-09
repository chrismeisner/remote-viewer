"use client";

import { useEffect, useState, useMemo, useCallback, useRef, memo } from "react";
import AgentChatModal from "@/components/AgentChatModal";

type CoverFile = {
  filename: string;
  url: string;
};

const GAP = 4; // px gap between covers
const POSTER_RATIO = 4 / 7; // 4:7 ratio (width:height)
const FADE_DURATION_MS = 1500; // smooth 1.5s crossfade
const SWAP_INTERVAL_MS = 2000; // swap a random cover every 2s

function useGridSize() {
  const [size, setSize] = useState({ cols: 0, rows: 0 });

  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      // Dynamic columns based on width
      const cols = w < 500 ? 4 : w < 768 ? 6 : w < 1024 ? 8 : w < 1440 ? 10 : 12;
      
      // Calculate poster dimensions based on 4:7 ratio
      const posterW = (w - GAP * (cols + 1)) / cols;
      const posterH = posterW / POSTER_RATIO;
      
      // How many rows fit in viewport (add extra to allow bottom bleed)
      const rows = Math.ceil((h - GAP) / (posterH + GAP)) + 1;
      
      setSize({ cols, rows });
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  return size;
}

// ---------- Crossfade Cell ----------
// Each cell independently manages a dual-layer crossfade.
// When `cover` prop changes the cell preloads the new image,
// then smoothly fades it in over the old one – no flash, no gap.
const CrossfadeCell = memo(function CrossfadeCell({ 
  cover, 
  onClick 
}: { 
  cover: CoverFile;
  onClick?: () => void;
}) {
  // Two layers: "back" sits behind "front"
  // On a swap we put the NEW image on back at opacity 0,
  // then fade it to 1 while fading front to 0.
  // After the transition we promote back → front.
  const [front, setFront] = useState<string>(cover.url);
  const [back, setBack] = useState<string | null>(null);
  const [backVisible, setBackVisible] = useState(false);
  const [frontLoaded, setFrontLoaded] = useState(false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUrl = useRef(cover.url);

  // When the cover prop changes, kick off crossfade
  useEffect(() => {
    if (cover.url === prevUrl.current) return;
    prevUrl.current = cover.url;

    // Clean up any in-flight transition
    if (transitionTimer.current) clearTimeout(transitionTimer.current);

    // Preload the new image
    const img = new Image();
    img.onload = () => {
      // Place the preloaded image on the back layer (opacity 0)
      setBack(cover.url);
      setBackVisible(false);

      // Wait one frame so the browser paints the back layer at opacity 0,
      // then trigger the fade-in by setting backVisible = true
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setBackVisible(true);

          // After the CSS transition finishes, promote back → front
          transitionTimer.current = setTimeout(() => {
            setFront(cover.url);
            setFrontLoaded(true);
            setBack(null);
            setBackVisible(false);
          }, FADE_DURATION_MS + 50); // small buffer past transition end
        });
      });
    };
    img.src = cover.url;

    return () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    };
  }, [cover.url]);

  return (
    <div
      className="relative rounded-lg overflow-hidden bg-neutral-900 flex-shrink-0"
      style={{ width: "100%", aspectRatio: `${POSTER_RATIO}` }}
      onClick={onClick}
    >
      {/* Front layer – current image */}
      <img
        src={front}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: frontLoaded ? 1 : 0,
          transition: `opacity ${FADE_DURATION_MS}ms ease-in-out`,
          willChange: "opacity",
        }}
        loading="lazy"
        onLoad={() => setFrontLoaded(true)}
        onError={() => setFrontLoaded(true)}
      />

      {/* Back layer – new image fading in on top */}
      {back && (
        <img
          src={back}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: backVisible ? 1 : 0,
            transition: `opacity ${FADE_DURATION_MS}ms ease-in-out`,
            willChange: "opacity",
          }}
        />
      )}
    </div>
  );
});

export default function CoverFlowPage() {
  const [covers, setCovers] = useState<CoverFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCoversList, setVisibleCoversList] = useState<CoverFile[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [lastClickTime, setLastClickTime] = useState(0);
  const { cols, rows } = useGridSize();
  const coversRef = useRef<CoverFile[]>([]);

  // Keep a ref in sync so the interval closure always sees current covers
  useEffect(() => {
    coversRef.current = covers;
  }, [covers]);

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
          for (const [relPath, item] of Object.entries(items)) {
            // Skip series (files in folders are considered series)
            const isSeries = relPath.includes("/");
            if (isSeries) continue;
            
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

  // Pick a random subset and distribute to fill columns with overflow
  const initialVisibleCovers = useMemo(() => {
    if (covers.length === 0 || cols === 0 || rows === 0) return [];
    
    const shuffled = [...covers].sort(() => Math.random() - 0.5);
    
    // Calculate how many covers we need per column to ensure overflow
    const coversPerColumn = rows + 6; // Large buffer for stagger offset
    const total = cols * coversPerColumn;
    
    // If we have fewer covers than slots, repeat to fill
    const pool: CoverFile[] = [];
    while (pool.length < total) {
      pool.push(...shuffled);
    }
    return pool.slice(0, total);
  }, [covers, cols, rows]);

  // Initialize visible covers list
  useEffect(() => {
    if (initialVisibleCovers.length > 0) {
      setVisibleCoversList(initialVisibleCovers);
    }
  }, [initialVisibleCovers]);

  // Randomly swap covers using a stable callback that reads from ref
  const swapRandomCover = useCallback(() => {
    const allCovers = coversRef.current;
    if (allCovers.length === 0) return;

    setVisibleCoversList((prev) => {
      if (prev.length === 0) return prev;
      const idx = Math.floor(Math.random() * prev.length);
      const newCover = allCovers[Math.floor(Math.random() * allCovers.length)];
      // Only swap if it's actually a different cover
      if (prev[idx].url === newCover.url) return prev;
      const next = [...prev];
      next[idx] = newCover;
      return next;
    });
  }, []);

  // Manual swap for a specific cover index (triggered by click)
  const swapSpecificCover = useCallback((idx: number) => {
    const now = Date.now();
    // Gate: only allow click swap once every 2 seconds
    if (now - lastClickTime < 2000) return;
    setLastClickTime(now);

    const allCovers = coversRef.current;
    if (allCovers.length === 0) return;

    setVisibleCoversList((prev) => {
      if (prev.length === 0 || idx >= prev.length) return prev;
      const newCover = allCovers[Math.floor(Math.random() * allCovers.length)];
      // Only swap if it's actually a different cover
      if (prev[idx].url === newCover.url) return prev;
      const next = [...prev];
      next[idx] = newCover;
      return next;
    });
  }, [lastClickTime]);

  // Interval that triggers swaps – no stale closures
  useEffect(() => {
    if (covers.length === 0 || visibleCoversList.length === 0) return;
    
    // Start first swap immediately
    swapRandomCover();
    
    // Then continue with interval
    const interval = setInterval(swapRandomCover, SWAP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [covers.length, visibleCoversList.length, swapRandomCover]);

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

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <div
        className="flex h-full w-full"
        style={{
          gap: `${GAP}px`,
          padding: `${GAP}px`,
        }}
      >
        {Array.from({ length: cols }).map((_, colIndex) => {
          // Calculate stagger offset - alternate columns offset by ~30% of poster height
          const posterW = (window.innerWidth - GAP * (cols + 1)) / cols;
          const posterH = posterW / POSTER_RATIO;
          const staggerOffset = colIndex % 2 === 0 ? 0 : posterH * 0.3;
          
          // Get covers for this column
          const columnCovers = visibleCoversList.filter((_, idx) => idx % cols === colIndex);
          
          return (
            <div
              key={colIndex}
              className="flex-1 flex flex-col"
              style={{
                gap: `${GAP}px`,
                transform: `translateY(-${staggerOffset}px)`,
              }}
            >
              {columnCovers.map((cover, idx) => {
                // Calculate global index for this cover
                const globalIndex = visibleCoversList.findIndex((c, i) => 
                  i % cols === colIndex && Math.floor(i / cols) === idx
                );
                
                return (
                  <CrossfadeCell
                    key={`cell-${colIndex}-${idx}`}
                    cover={cover}
                    onClick={() => swapSpecificCover(globalIndex)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Chat FAB */}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-30 size-12 flex items-center justify-center rounded-full bg-emerald-600 text-neutral-100 shadow-lg transition-opacity duration-200 hover:bg-emerald-500"
          aria-label="Open chat"
        >
          <svg
            className="size-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </button>
      )}

      {/* Agent Chat Modal */}
      <AgentChatModal open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
