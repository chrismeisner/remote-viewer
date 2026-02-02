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
      } else if (e.key === "Escape") {
        window.history.back();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch covers
  useEffect(() => {
    const fetchCovers = async () => {
      try {
        // Try local covers first, then remote
        const localRes = await fetch("/api/covers?source=local");
        const localData = await localRes.json();
        
        let allCovers: CoverFile[] = localData.covers || [];
        
        // Also fetch remote covers if FTP is configured
        const remoteRes = await fetch("/api/covers?source=remote");
        const remoteData = await remoteRes.json();
        
        if (remoteData.covers && remoteData.covers.length > 0) {
          // Merge, avoiding duplicates by filename
          const localFilenames = new Set(allCovers.map((c) => c.filename));
          const uniqueRemote = remoteData.covers.filter(
            (c: CoverFile) => !localFilenames.has(c.filename)
          );
          allCovers = [...allCovers, ...uniqueRemote];
        }

        if (allCovers.length === 0) {
          setError("No covers found in your media library");
        } else {
          setCovers(allCovers);
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
          <a
            href="/admin/covers"
            className="inline-flex items-center gap-2 rounded-md bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-sm font-semibold text-black transition"
          >
            Manage Covers
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="cover-flow-container">
      {/* Cover Flow Grid */}
      <div className="cover-flow-grid">
        {columns.map((column, colIndex) => (
          <div
            key={colIndex}
            className="cover-flow-column"
          >
            <div
              className={`cover-flow-scroll ${isPaused ? "paused" : ""}`}
              style={{
                animationDuration: `${column.speed}s`,
                animationDirection: column.reverse ? "reverse" : "normal",
                animationDelay: `-${(column.offset / 33.333) * column.speed}s`,
              }}
            >
              {column.covers.map((cover, idx) => (
                <div
                  key={`${cover.filename}-${idx}`}
                  className="cover-item"
                >
                  <img
                    src={cover.url}
                    alt=""
                    className="cover-image"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0";
                    }}
                  />
                  <div className="cover-shine" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Gradient overlays for depth */}
      <div className="gradient-top" />
      <div className="gradient-bottom" />

      {/* Controls overlay */}
      <div className={`controls-overlay ${showControls ? "visible" : ""}`}>
        <div className="controls-bar">
          <div className="controls-left">
            <a href="/player" className="control-btn" title="Back to player">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </a>
            <div className="divider" />
            <div className="text-sm">
              <p className="font-medium text-white">Cover Flow</p>
              <p className="text-xs text-neutral-500">{covers.length} covers</p>
            </div>
          </div>

          <div className="controls-right">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="control-btn"
              title={isPaused ? "Play" : "Pause"}
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
        
        {/* Keyboard hints - hide on mobile */}
        <div className="keyboard-hints">
          <span>
            <kbd>Space</kbd> pause
          </span>
          <span>
            <kbd>Esc</kbd> exit
          </span>
        </div>
      </div>

      {/* CSS for mobile-friendly cover flow */}
      <style jsx>{`
        .cover-flow-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          height: 100dvh; /* Dynamic viewport height for mobile */
          background: black;
          overflow: hidden;
          touch-action: none; /* Prevent pull-to-refresh */
          -webkit-overflow-scrolling: touch;
        }

        .cover-flow-grid {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          gap: 8px;
          padding: 8px;
        }

        @media (min-width: 640px) {
          .cover-flow-grid {
            gap: 12px;
            padding: 12px;
          }
        }

        .cover-flow-column {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          position: relative;
        }

        /* Hide extra columns on mobile */
        .cover-flow-column:nth-child(n+4) {
          display: none;
        }

        @media (min-width: 480px) {
          .cover-flow-column:nth-child(n+4) {
            display: block;
          }
          .cover-flow-column:nth-child(n+5) {
            display: none;
          }
        }

        @media (min-width: 640px) {
          .cover-flow-column:nth-child(n+5) {
            display: block;
          }
          .cover-flow-column:nth-child(n+6) {
            display: none;
          }
        }

        @media (min-width: 768px) {
          .cover-flow-column:nth-child(n+6) {
            display: block;
          }
          .cover-flow-column:nth-child(n+7) {
            display: none;
          }
        }

        @media (min-width: 1024px) {
          .cover-flow-column:nth-child(n+7) {
            display: block;
          }
        }

        .cover-flow-scroll {
          display: flex;
          flex-direction: column;
          gap: 8px;
          will-change: transform;
          -webkit-animation: scroll linear infinite;
          animation: scroll linear infinite;
        }

        @media (min-width: 640px) {
          .cover-flow-scroll {
            gap: 12px;
          }
        }

        .cover-flow-scroll.paused {
          -webkit-animation-play-state: paused;
          animation-play-state: paused;
        }

        @-webkit-keyframes scroll {
          0% {
            -webkit-transform: translateY(0);
            transform: translateY(0);
          }
          100% {
            -webkit-transform: translateY(-33.333%);
            transform: translateY(-33.333%);
          }
        }

        @keyframes scroll {
          0% {
            -webkit-transform: translateY(0);
            transform: translateY(0);
          }
          100% {
            -webkit-transform: translateY(-33.333%);
            transform: translateY(-33.333%);
          }
        }

        .cover-item {
          position: relative;
          aspect-ratio: 2/3;
          border-radius: 8px;
          overflow: hidden;
          flex-shrink: 0;
          background: #171717;
        }

        .cover-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
        }

        .cover-shine {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 50%, rgba(0,0,0,0.2) 100%);
          pointer-events: none;
        }

        .gradient-top {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 80px;
          background: linear-gradient(to bottom, black, rgba(0,0,0,0.5), transparent);
          pointer-events: none;
          z-index: 10;
        }

        .gradient-bottom {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 120px;
          background: linear-gradient(to top, black, rgba(0,0,0,0.5), transparent);
          pointer-events: none;
          z-index: 10;
        }

        .controls-overlay {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 16px;
          padding-bottom: max(16px, env(safe-area-inset-bottom));
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.5s;
          z-index: 20;
        }

        .controls-overlay.visible {
          opacity: 1;
          pointer-events: auto;
        }

        .controls-bar {
          max-width: 400px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(0,0,0,0.8);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.1);
          padding: 12px 16px;
        }

        .controls-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .controls-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .control-btn {
          padding: 8px;
          border-radius: 8px;
          color: #a3a3a3;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .control-btn:hover,
        .control-btn:active {
          background: rgba(255,255,255,0.1);
          color: white;
        }

        .divider {
          width: 1px;
          height: 24px;
          background: rgba(255,255,255,0.1);
        }

        .keyboard-hints {
          margin-top: 12px;
          display: none;
          align-items: center;
          justify-content: center;
          gap: 16px;
          font-size: 12px;
          color: #525252;
        }

        @media (min-width: 640px) {
          .keyboard-hints {
            display: flex;
          }
        }

        .keyboard-hints kbd {
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          font-family: monospace;
          font-size: 11px;
        }

        /* Reduce motion for users who prefer it */
        @media (prefers-reduced-motion: reduce) {
          .cover-flow-scroll {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
