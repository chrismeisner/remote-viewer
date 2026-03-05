"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type QuickFactConfig = {
  prompt: string;
  maxTokens: number;
  model: string;
  holdSeconds: number;
  typingSpeedMs: number;
  widthVw: number;
  autoPlayOnChannelSwitch?: boolean;
  autoPlayDelaySeconds?: number;
  textBackground?: boolean;
  enabledVars?: {
    title?: boolean;
    year?: boolean;
    director?: boolean;
    type?: boolean;
    genre?: boolean;
    plot?: boolean;
    production?: boolean;
    castTags?: boolean;
    imdbUrl?: boolean;
    episodeDetails?: boolean;
    playbackPosition?: boolean;
  };
};

export type QuickFactMediaMetadata = {
  title?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: "film" | "tv" | "documentary" | "sports" | "concert" | "other" | null;
  season?: number | null;
  episode?: number | null;
  tags?: string[] | null;
  imdbUrl?: string | null;
};

export interface UseQuickFactOptions {
  infoMetadata: QuickFactMediaMetadata | null;
  /** Fallback title when metadata has none (e.g. nowPlaying.title or filePath) */
  title: string;
  currentPlaybackTime: number;
  durationSeconds: number;
  mediaSource: string;
  /** When false, triggerQuickFact is a no-op (e.g. nothing is loaded yet) */
  enabled?: boolean;
}

function formatTimeForDisplay(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function useQuickFact({
  infoMetadata,
  title,
  currentPlaybackTime,
  durationSeconds,
  mediaSource,
  enabled = true,
}: UseQuickFactOptions) {
  const [quickFactText, setQuickFactText] = useState("");
  const [quickFactDisplay, setQuickFactDisplay] = useState("");
  const [showQuickFact, setShowQuickFact] = useState(false);
  const [quickFactLoading, setQuickFactLoading] = useState(false);
  const quickFactTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const quickFactTypewriterRef = useRef<NodeJS.Timeout | null>(null);
  const quickFactRequestIdRef = useRef(0);
  const quickFactConfigRef = useRef<QuickFactConfig | null>(null);
  const previousFactsRef = useRef<string[]>([]);

  // Load config on mount / media source change
  useEffect(() => {
    fetch(`/api/quick-fact-config?source=${mediaSource}&t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => {
        quickFactConfigRef.current = data.config;
      })
      .catch(() => {});
  }, [mediaSource]);

  // Typewriter effect
  useEffect(() => {
    if (!quickFactText) return;
    if (quickFactTypewriterRef.current) clearTimeout(quickFactTypewriterRef.current);
    setQuickFactDisplay("");
    const holdMs = (quickFactConfigRef.current?.holdSeconds ?? 8) * 1000;
    const speedMs = quickFactConfigRef.current?.typingSpeedMs ?? 30;
    let i = 0;
    const tick = () => {
      i++;
      setQuickFactDisplay(quickFactText.slice(0, i));
      if (i < quickFactText.length) {
        quickFactTypewriterRef.current = setTimeout(tick, speedMs);
      } else {
        quickFactTimeoutRef.current = setTimeout(() => {
          setShowQuickFact(false);
        }, holdMs);
      }
    };
    tick();
    return () => {
      if (quickFactTypewriterRef.current) clearTimeout(quickFactTypewriterRef.current);
    };
  }, [quickFactText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (quickFactTimeoutRef.current) clearTimeout(quickFactTimeoutRef.current);
      if (quickFactTypewriterRef.current) clearTimeout(quickFactTypewriterRef.current);
    };
  }, []);

  const clearQuickFact = useCallback((cancelInFlight = true) => {
    if (cancelInFlight) {
      quickFactRequestIdRef.current += 1;
      // Reset the seen-facts history when changing channels
      previousFactsRef.current = [];
    }
    if (quickFactTimeoutRef.current) {
      clearTimeout(quickFactTimeoutRef.current);
      quickFactTimeoutRef.current = null;
    }
    if (quickFactTypewriterRef.current) {
      clearTimeout(quickFactTypewriterRef.current);
      quickFactTypewriterRef.current = null;
    }
    setQuickFactLoading(false);
    setShowQuickFact(false);
    setQuickFactDisplay("");
    setQuickFactText("");
  }, []);

  const triggerQuickFact = useCallback(() => {
    if (quickFactLoading || !enabled) return;

    if (quickFactTimeoutRef.current) clearTimeout(quickFactTimeoutRef.current);
    if (quickFactTypewriterRef.current) clearTimeout(quickFactTypewriterRef.current);
    setQuickFactDisplay("");
    setQuickFactText("");
    setShowQuickFact(true);
    setQuickFactLoading(true);
    const requestId = ++quickFactRequestIdRef.current;

    const cfg = quickFactConfigRef.current;
    const ev = cfg?.enabledVars ?? {};
    const showTitle    = ev.title            !== false;
    const showYear     = ev.year             !== false;
    const showDirector = ev.director         !== false;
    const showType     = ev.type             !== false;
    const showGenre    = ev.genre            !== false;
    const showPlot     = ev.plot             !== false;
    const showProd     = ev.production       !== false;
    const showCast     = ev.castTags         !== false;
    const showImdb     = ev.imdbUrl          !== false;
    const showEpisode  = ev.episodeDetails   !== false;
    const showPos      = ev.playbackPosition !== false;

    const meta = infoMetadata;
    const displayTitle = showTitle ? title : "";
    const year = showYear && meta?.year ? ` (${meta.year})` : "";
    const season = showEpisode && typeof meta?.season === "number" ? String(meta.season) : "";
    const episode = showEpisode && typeof meta?.episode === "number" ? String(meta.episode) : "";
    const episodeCode =
      season && episode
        ? `S${season.padStart(2, "0")}E${episode.padStart(2, "0")}`
        : "";
    const releaseDate = showEpisode && meta?.releaseDate ? meta.releaseDate : "";
    const timestamp = showPos ? formatTimeForDisplay(currentPlaybackTime) : "";
    const durationStr = showPos ? formatTimeForDisplay(durationSeconds) : "";
    const pct =
      showPos && durationSeconds > 0
        ? Math.round((currentPlaybackTime / durationSeconds) * 100)
        : 0;

    const metaLines: string[] = [];
    if (showTitle) metaLines.push(`Title: ${displayTitle}${year}`);
    if (showType && meta?.type) metaLines.push(`Type: ${meta.type}`);
    if (showEpisode) {
      if (season) metaLines.push(`Season: ${season}`);
      if (episode) metaLines.push(`Episode: ${episode}`);
      if (episodeCode) metaLines.push(`Episode Code: ${episodeCode}`);
      if (releaseDate) metaLines.push(`Air Date: ${releaseDate}`);
    }
    if (showImdb && meta?.imdbUrl) metaLines.push(`IMDb: ${meta.imdbUrl}`);
    if (showDirector && meta?.director) metaLines.push(`Director: ${meta.director}`);
    if (showGenre && meta?.category) metaLines.push(`Genre: ${meta.category}`);
    if (showPlot && meta?.plot) metaLines.push(`Plot: ${meta.plot}`);
    if (showProd && meta?.makingOf) metaLines.push(`Production: ${meta.makingOf}`);
    if (showCast && meta?.tags?.length) metaLines.push(`Cast/Tags: ${meta.tags!.join(", ")}`);
    if (showPos)
      metaLines.push(`\nPLAYBACK POSITION: ${timestamp} of ${durationStr} (${pct}% through)`);
    const metaContext = metaLines.join("\n");

    const promptTemplate =
      cfg?.prompt ||
      `You are a text overlay inside a TV player. The viewer just pressed a button to get a quick fact about what they're watching RIGHT NOW. You know the current playback position — use it to identify approximately what scene or moment is happening and give a fact relevant to THAT part of the film/show. Use web search to look up scene-by-scene breakdowns if needed. Respond with ONLY a single short sentence (max 20 words). Do NOT use markdown, bullet points, or multiple sentences. Format: start with a brief scene/moment reference, then "—" and a relevant fact. Example: "The rooftop chase scene — Rutger Hauer improvised the famous 'tears in rain' monologue"`;

    const seenFacts = previousFactsRef.current;
    const seenFactsNote =
      seenFacts.length > 0
        ? `\n\nAlready shown to this viewer — DO NOT repeat or closely paraphrase these:\n${seenFacts.map((f) => `- ${f}`).join("\n")}`
        : "";

    const interpolatedPrompt = promptTemplate
      .replace(/\{\{title\}\}/g, displayTitle)
      .replace(/\{\{year\}\}/g, year)
      .replace(/\{\{imdbUrl\}\}/g, showImdb && meta?.imdbUrl ? meta.imdbUrl : "")
      .replace(/\{\{season\}\}/g, season)
      .replace(/\{\{episode\}\}/g, episode)
      .replace(/\{\{episodeCode\}\}/g, episodeCode)
      .replace(/\{\{releaseDate\}\}/g, releaseDate)
      .replace(/\{\{timestamp\}\}/g, timestamp)
      .replace(/\{\{duration\}\}/g, durationStr)
      .replace(/\{\{percent\}\}/g, pct ? String(pct) : "")
      .replace(/\{\{metaContext\}\}/g, metaContext);

    const userMsg =
      showPos && timestamp
        ? `I'm at ${timestamp} of ${durationStr} (${pct}% through). Give me a fact about what's happening around this point in the film/show.`
        : "Give me an interesting fact about this media.";

    const systemNote = metaContext
      ? `${interpolatedPrompt}\n\nMedia info:\n${metaContext}${seenFactsNote}`
      : `${interpolatedPrompt}${seenFactsNote}`;

    console.group(`[quick-fact] request #${requestId}`);
    console.log("[quick-fact] model:", cfg?.model || "gpt-4.1");
    console.log("[quick-fact] user message:", userMsg);
    console.log("[quick-fact] system note:\n", systemNote);
    console.log("[quick-fact] seen facts history:", seenFacts.length ? seenFacts : "(none)");
    console.groupEnd();

    fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: userMsg }],
        model: cfg?.model || "gpt-4.1",
        maxTokens: cfg?.maxTokens || 200,
        systemNote,
      }),
    })
      .then(async (res) => {
        if (requestId !== quickFactRequestIdRef.current) return;
        if (!res.ok) throw new Error("AI request failed");
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No body");
        const decoder = new TextDecoder();
        let full = "";
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.type === "text") full += evt.delta;
            } catch {
              /* skip */
            }
          }
        }
        if (requestId !== quickFactRequestIdRef.current) return;
        console.log(`[quick-fact] raw response #${requestId}:`, full);
        const cleaned = full
          .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/\(\s*https?:\/\/[^\s)]+\s*\)/g, "")
          .replace(/https?:\/\/\S+/g, "")
          .replace(/\*\*/g, "")
          .replace(/[*_#`]/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        const fallback = displayTitle
          ? `You're watching ${displayTitle}${year}`
          : "Quick fact unavailable";
        const finalFact = cleaned || fallback;
        console.log(`[quick-fact] displayed #${requestId}:`, finalFact);
        // Record this fact so future prompts on the same channel can avoid repeating it
        previousFactsRef.current = [...previousFactsRef.current, finalFact].slice(-5);
        console.log("[quick-fact] updated history:", previousFactsRef.current);
        setQuickFactText(finalFact);
      })
      .catch((err) => {
        if (requestId !== quickFactRequestIdRef.current) return;
        console.error(`[quick-fact] error #${requestId}:`, err);
        const fallback = displayTitle
          ? `You're watching ${displayTitle}${year}`
          : "Quick fact unavailable";
        setQuickFactText(fallback);
      })
      .finally(() => {
        if (requestId === quickFactRequestIdRef.current) {
          setQuickFactLoading(false);
        }
      });
  }, [quickFactLoading, enabled, infoMetadata, title, currentPlaybackTime, durationSeconds]);

  return {
    showQuickFact,
    quickFactDisplay,
    quickFactText,
    quickFactLoading,
    quickFactConfigRef,
    triggerQuickFact,
    clearQuickFact,
  };
}
