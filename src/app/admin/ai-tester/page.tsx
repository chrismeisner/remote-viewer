"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MEDIA_SOURCE_KEY,
  type MediaSource,
} from "@/constants/media";

type EnabledVars = {
  title: boolean;
  year: boolean;
  director: boolean;
  type: boolean;
  genre: boolean;
  plot: boolean;
  production: boolean;
  castTags: boolean;
  imdbUrl: boolean;
  episodeDetails: boolean;
  playbackPosition: boolean;
};

const DEFAULT_ENABLED_VARS: EnabledVars = {
  title: true,
  year: true,
  director: true,
  type: true,
  genre: true,
  plot: true,
  production: true,
  castTags: true,
  imdbUrl: true,
  episodeDetails: true,
  playbackPosition: true,
};

const VAR_DEFINITIONS: {
  key: keyof EnabledVars;
  label: string;
  templateVars: string[];
  description: string;
}[] = [
  { key: "title",           label: "Title",            templateVars: ["{{title}}"],                                  description: "Media title" },
  { key: "year",            label: "Year",             templateVars: ["{{year}}"],                                   description: "Release year" },
  { key: "director",        label: "Director",         templateVars: [],                                             description: "Director name" },
  { key: "type",            label: "Type",             templateVars: [],                                             description: "Media type (film, tv, documentary…)" },
  { key: "genre",           label: "Genre",            templateVars: [],                                             description: "Genre / category" },
  { key: "plot",            label: "Plot",             templateVars: [],                                             description: "Plot summary" },
  { key: "production",      label: "Production",       templateVars: [],                                             description: "Behind-the-scenes / production notes" },
  { key: "castTags",        label: "Cast / Tags",      templateVars: [],                                             description: "Cast members and tags" },
  { key: "imdbUrl",         label: "IMDb URL",         templateVars: ["{{imdbUrl}}"],                               description: "Canonical IMDb page for this title/episode (if available)" },
  { key: "episodeDetails",  label: "Episode Details",  templateVars: ["{{season}}", "{{episode}}", "{{episodeCode}}", "{{releaseDate}}"], description: "Season/episode and release date for episodic content" },
  { key: "playbackPosition", label: "Playback Position", templateVars: ["{{timestamp}}", "{{duration}}", "{{percent}}"], description: "Current position, duration, and percentage" },
];

type QuickFactConfig = {
  prompt: string;
  maxTokens: number;
  model: string;
  holdSeconds: number;
  typingSpeedMs: number;
  widthVw: number;
  autoPlayOnChannelSwitch: boolean;
  autoPlayDelaySeconds: number;
  enabledVars: EnabledVars;
};

type MediaItem = {
  relPath: string;
  title?: string;
  year?: number;
  director?: string;
  type?: string;
  category?: string;
  plot?: string;
  makingOf?: string;
  tags?: string[];
  imdbUrl?: string;
  season?: number;
  episode?: number;
  releaseDate?: string;
  durationSeconds?: number;
};

type StreamEvent =
  | { type: "status"; status: string }
  | { type: "text"; delta: string };

type AiTestRequestPayload = {
  userMsg: string;
  systemNote: string;
  interpolated: string;
  metaContext: string;
  enabledKeys: (keyof EnabledVars)[];
  disabledKeys: (keyof EnabledVars)[];
};

const AVAILABLE_MODELS = [
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "gpt-5", name: "GPT-5" },
  { id: "gpt-5-mini", name: "GPT-5 Mini" },
];

const TOKEN_OPTIONS = [
  { value: 100, label: "Tiny (100)" },
  { value: 200, label: "Short (200)" },
  { value: 400, label: "Medium (400)" },
  { value: 800, label: "Long (800)" },
];

const HOLD_OPTIONS = [
  { value: 4, label: "4s" },
  { value: 6, label: "6s" },
  { value: 8, label: "8s" },
  { value: 12, label: "12s" },
  { value: 20, label: "20s" },
];

const TYPING_SPEED_OPTIONS = [
  { value: 5, label: "Very Fast (5ms)" },
  { value: 15, label: "Fast (15ms)" },
  { value: 30, label: "Normal (30ms)" },
  { value: 50, label: "Slow (50ms)" },
  { value: 80, label: "Very Slow (80ms)" },
];

const WIDTH_OPTIONS = [
  { value: 30, label: "30vw" },
  { value: 40, label: "40vw" },
  { value: 50, label: "50vw" },
  { value: 60, label: "60vw" },
  { value: 70, label: "70vw" },
  { value: 80, label: "80vw" },
  { value: 90, label: "90vw" },
  { value: 100, label: "100vw" },
];

const AUTO_PLAY_DELAY_OPTIONS = [
  { value: 2, label: "2s after channel loads" },
  { value: 3, label: "3s after channel loads" },
  { value: 5, label: "5s after channel loads" },
  { value: 8, label: "8s after channel loads" },
  { value: 10, label: "10s after channel loads" },
  { value: 15, label: "15s after channel loads" },
];

function cleanAiText(text: string): string {
  return text
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")  // ([label](url)) → remove whole citation
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")          // [label](url) → label
    .replace(/\(\s*https?:\/\/[^\s)]+\s*\)/g, "")     // (https://...) → remove
    .replace(/https?:\/\/\S+/g, "")                   // bare URLs → remove
    .replace(/\*\*/g, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildMetaContext(
  media: MediaItem,
  playbackPercent: number,
  ev: EnabledVars = DEFAULT_ENABLED_VARS
): {
  metaContext: string;
  timestamp: string;
  duration: string;
  pct: number;
  title: string;
  year: string;
  season: string;
  episode: string;
  episodeCode: string;
  releaseDate: string;
} {
  const title = ev.title ? (media.title || media.relPath) : "";
  const year = ev.year && media.year ? ` (${media.year})` : "";
  const dur = media.durationSeconds || 7200;
  const currentSec = Math.round((playbackPercent / 100) * dur);
  const timestamp = ev.playbackPosition ? formatSeconds(currentSec) : "";
  const duration = ev.playbackPosition ? formatSeconds(dur) : "";
  const pct = ev.playbackPosition ? Math.round(playbackPercent) : 0;
  const season = ev.episodeDetails && typeof media.season === "number" ? String(media.season) : "";
  const episode = ev.episodeDetails && typeof media.episode === "number" ? String(media.episode) : "";
  const releaseDate = ev.episodeDetails && media.releaseDate ? media.releaseDate : "";
  const episodeCode =
    season && episode
      ? `S${season.padStart(2, "0")}E${episode.padStart(2, "0")}`
      : "";

  const lines: string[] = [];
  if (ev.title)           lines.push(`Title: ${title}${year}`);
  if (ev.director && media.director)  lines.push(`Director: ${media.director}`);
  if (ev.type && media.type)          lines.push(`Type: ${media.type}`);
  if (ev.genre && media.category)     lines.push(`Genre: ${media.category}`);
  if (ev.plot && media.plot)          lines.push(`Plot: ${media.plot}`);
  if (ev.production && media.makingOf) lines.push(`Production: ${media.makingOf}`);
  if (ev.castTags && media.tags?.length) lines.push(`Cast/Tags: ${media.tags!.join(", ")}`);
  if (ev.imdbUrl && media.imdbUrl)    lines.push(`IMDb: ${media.imdbUrl}`);
  if (ev.episodeDetails) {
    if (episodeCode) {
      lines.push(`Episode: ${episodeCode}`);
    } else {
      if (season) lines.push(`Season: ${season}`);
      if (episode) lines.push(`Episode: ${episode}`);
    }
    if (releaseDate) lines.push(`Release Date: ${releaseDate}`);
  }
  if (ev.playbackPosition) lines.push(`\nPLAYBACK POSITION: ${timestamp} of ${duration} (${pct}% through)`);

  return { metaContext: lines.join("\n"), timestamp, duration, pct, title, year, season, episode, episodeCode, releaseDate };
}

function interpolatePrompt(
  template: string,
  media: MediaItem,
  playbackPercent: number,
  ev: EnabledVars = DEFAULT_ENABLED_VARS
): string {
  const { metaContext, timestamp, duration, pct, title, year, season, episode, episodeCode, releaseDate } = buildMetaContext(media, playbackPercent, ev);

  return template
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{year\}\}/g, year)
    .replace(/\{\{imdbUrl\}\}/g, ev.imdbUrl && media.imdbUrl ? media.imdbUrl : "")
    .replace(/\{\{season\}\}/g, season)
    .replace(/\{\{episode\}\}/g, episode)
    .replace(/\{\{episodeCode\}\}/g, episodeCode)
    .replace(/\{\{releaseDate\}\}/g, releaseDate)
    .replace(/\{\{timestamp\}\}/g, timestamp)
    .replace(/\{\{duration\}\}/g, duration)
    .replace(/\{\{percent\}\}/g, pct ? String(pct) : "")
    .replace(/\{\{metaContext\}\}/g, metaContext);
}

function buildAiTestRequestPayload(
  media: MediaItem,
  playbackPercent: number,
  promptTemplate: string,
  ev: EnabledVars
): AiTestRequestPayload {
  const normalizedVars: EnabledVars = { ...DEFAULT_ENABLED_VARS, ...ev };
  const { metaContext, timestamp, duration, pct } = buildMetaContext(
    media,
    playbackPercent,
    normalizedVars
  );
  const interpolated = interpolatePrompt(
    promptTemplate,
    media,
    playbackPercent,
    normalizedVars
  );
  const userMsg = normalizedVars.playbackPosition && timestamp
    ? `I'm at ${timestamp} of ${duration} (${pct}% through). Give me a fact about what's happening around this point in the film/show.`
    : "Give me an interesting fact about this media.";
  const systemNote = metaContext
    ? `${interpolated}\n\nMedia info:\n${metaContext}`
    : interpolated;
  const enabledKeys = (Object.keys(normalizedVars) as (keyof EnabledVars)[])
    .filter((k) => normalizedVars[k]);
  const disabledKeys = (Object.keys(normalizedVars) as (keyof EnabledVars)[])
    .filter((k) => !normalizedVars[k]);

  return {
    userMsg,
    systemNote,
    interpolated,
    metaContext,
    enabledKeys,
    disabledKeys,
  };
}

export default function AiTesterPage() {
  const [config, setConfig] = useState<QuickFactConfig | null>(null);
  const [defaults, setDefaults] = useState<QuickFactConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("remote");

  // Media list
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<string>("");

  // Simulated playback position
  const [playbackPercent, setPlaybackPercent] = useState(25);

  // Test run
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testStreaming, setTestStreaming] = useState(false);

  // Draft edits (separate from saved config)
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftMaxTokens, setDraftMaxTokens] = useState(200);
  const [draftModel, setDraftModel] = useState("gpt-4o");
  const [draftHoldSeconds, setDraftHoldSeconds] = useState(8);
  const [draftTypingSpeedMs, setDraftTypingSpeedMs] = useState(30);
  const [draftWidthVw, setDraftWidthVw] = useState(80);
  const [draftAutoPlayOnChannelSwitch, setDraftAutoPlayOnChannelSwitch] = useState(false);
  const [draftAutoPlayDelaySeconds, setDraftAutoPlayDelaySeconds] = useState(5);
  const [draftEnabledVars, setDraftEnabledVars] = useState<EnabledVars>(DEFAULT_ENABLED_VARS);

  // Typewriter preview state
  const [previewDisplay, setPreviewDisplay] = useState<string | null>(null);
  const previewTypewriterRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
    if (stored === "remote" || stored === "local") setMediaSource(stored);
  }, []);

  // Typewriter preview: replay testResult at draftTypingSpeedMs when streaming ends
  useEffect(() => {
    if (previewTypewriterRef.current) clearTimeout(previewTypewriterRef.current);
    if (testResult === null || testStreaming) {
      setPreviewDisplay(testStreaming ? testResult : null);
      return;
    }
    setPreviewDisplay("");
    let i = 0;
    const tick = () => {
      i++;
      setPreviewDisplay(testResult.slice(0, i));
      if (i < testResult.length) {
        previewTypewriterRef.current = setTimeout(tick, draftTypingSpeedMs);
      }
    };
    tick();
    return () => {
      if (previewTypewriterRef.current) clearTimeout(previewTypewriterRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testResult, testStreaming]);

  // Load config
  useEffect(() => {
    setLoading(true);
    fetch(`/api/quick-fact-config?source=${mediaSource}&t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => {
        setConfig(data.config);
        setDefaults(data.defaults);
        setDraftPrompt(data.config.prompt);
        setDraftMaxTokens(data.config.maxTokens);
        setDraftModel(data.config.model);
        setDraftHoldSeconds(data.config.holdSeconds);
        setDraftTypingSpeedMs(data.config.typingSpeedMs ?? 30);
        setDraftWidthVw(data.config.widthVw ?? 80);
        setDraftAutoPlayOnChannelSwitch(data.config.autoPlayOnChannelSwitch ?? false);
        setDraftAutoPlayDelaySeconds(data.config.autoPlayDelaySeconds ?? 5);
        setDraftEnabledVars({ ...DEFAULT_ENABLED_VARS, ...(data.config.enabledVars ?? {}) });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mediaSource]);

  // Load media library
  useEffect(() => {
    setMediaLoading(true);
    fetch(`/api/media-metadata?source=${mediaSource}&t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => {
        const items: MediaItem[] = Object.entries(
          data.items as Record<string, Record<string, unknown>>
        )
          .map(([relPath, meta]) => ({
            relPath,
            title: (meta.title as string) || undefined,
            year: (meta.year as number) || undefined,
            director: (meta.director as string) || undefined,
            type: (meta.type as string) || undefined,
            category: (meta.category as string) || undefined,
            plot: (meta.plot as string) || undefined,
            makingOf: (meta.makingOf as string) || undefined,
            tags: (meta.tags as string[]) || undefined,
            imdbUrl: (meta.imdbUrl as string) || undefined,
            season: (meta.season as number) || undefined,
            episode: (meta.episode as number) || undefined,
            releaseDate: (meta.releaseDate as string) || undefined,
          }))
          .sort((a, b) => {
            const nameA = a.title || a.relPath;
            const nameB = b.title || b.relPath;
            return nameA.localeCompare(nameB);
          });
        setMediaItems(items);
        if (items.length > 0 && !selectedMedia) {
          setSelectedMedia(items[0].relPath);
        }
      })
      .catch(() => {})
      .finally(() => setMediaLoading(false));
  }, [mediaSource]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedMediaItem = mediaItems.find((m) => m.relPath === selectedMedia);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/quick-fact-config?source=${mediaSource}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: draftPrompt,
          maxTokens: draftMaxTokens,
          model: draftModel,
          holdSeconds: draftHoldSeconds,
          typingSpeedMs: draftTypingSpeedMs,
          widthVw: draftWidthVw,
          autoPlayOnChannelSwitch: draftAutoPlayOnChannelSwitch,
          autoPlayDelaySeconds: draftAutoPlayDelaySeconds,
          enabledVars: draftEnabledVars,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setConfig(data.config);
      setSaveMessage("Saved — player will use these settings on next Q press.");
    } catch {
      setSaveMessage("Failed to save configuration.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(null), 4000);
    }
  }, [draftPrompt, draftMaxTokens, draftModel, draftHoldSeconds, draftTypingSpeedMs, draftWidthVw, draftAutoPlayOnChannelSwitch, draftAutoPlayDelaySeconds, draftEnabledVars, mediaSource]);

  const handleReset = () => {
    if (!defaults) return;
    setDraftPrompt(defaults.prompt);
    setDraftMaxTokens(defaults.maxTokens);
    setDraftModel(defaults.model);
    setDraftHoldSeconds(defaults.holdSeconds);
    setDraftTypingSpeedMs(defaults.typingSpeedMs ?? 30);
    setDraftWidthVw(defaults.widthVw ?? 80);
    setDraftAutoPlayOnChannelSwitch(defaults.autoPlayOnChannelSwitch ?? false);
    setDraftAutoPlayDelaySeconds(defaults.autoPlayDelaySeconds ?? 5);
    setDraftEnabledVars({ ...DEFAULT_ENABLED_VARS, ...(defaults.enabledVars ?? {}) });
  };

  const handleTest = useCallback(async () => {
    if (!selectedMediaItem || testRunning) return;

    setTestRunning(true);
    setTestResult(null);
    setTestStreaming(true);

    const payload = buildAiTestRequestPayload(
      selectedMediaItem,
      playbackPercent,
      draftPrompt,
      draftEnabledVars
    );

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: payload.userMsg }],
          model: draftModel,
          maxTokens: draftMaxTokens,
          systemNote: payload.systemNote,
        }),
      });

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
            const evt: StreamEvent = JSON.parse(line);
            if (evt.type === "text") {
              full += evt.delta;
              setTestResult(cleanAiText(full));
            }
          } catch { /* skip */ }
        }
      }

      const cleaned = cleanAiText(full);
      setTestResult(cleaned || "(empty response)");
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setTestRunning(false);
      setTestStreaming(false);
    }
  }, [selectedMediaItem, testRunning, draftPrompt, draftModel, draftMaxTokens, playbackPercent, draftEnabledVars]);

  const savedEnabledVars: EnabledVars = { ...DEFAULT_ENABLED_VARS, ...(config?.enabledVars ?? {}) };
  const enabledVarsDirty = config
    ? (Object.keys(DEFAULT_ENABLED_VARS) as (keyof EnabledVars)[]).some(
        (k) => draftEnabledVars[k] !== savedEnabledVars[k]
      )
    : false;

  const isDirty =
    config &&
    (draftPrompt !== config.prompt ||
      draftMaxTokens !== config.maxTokens ||
      draftModel !== config.model ||
      draftHoldSeconds !== config.holdSeconds ||
      draftTypingSpeedMs !== (config.typingSpeedMs ?? 30) ||
      draftWidthVw !== (config.widthVw ?? 80) ||
      draftAutoPlayOnChannelSwitch !== (config.autoPlayOnChannelSwitch ?? false) ||
      draftAutoPlayDelaySeconds !== (config.autoPlayDelaySeconds ?? 5) ||
      enabledVarsDirty);
  const enabledTemplateVars = VAR_DEFINITIONS.flatMap(({ key, templateVars }) =>
    draftEnabledVars[key] ? templateVars : []
  );
  const disabledTemplateVars = VAR_DEFINITIONS.flatMap(({ key, templateVars }) =>
    draftEnabledVars[key] ? [] : templateVars
  );
  const hasAnyEnabledContextVar = (Object.keys(draftEnabledVars) as (keyof EnabledVars)[])
    .some((k) => draftEnabledVars[k]);
  const requestPreview = selectedMediaItem
    ? buildAiTestRequestPayload(
        selectedMediaItem,
        playbackPercent,
        draftPrompt,
        draftEnabledVars
      )
    : null;

  if (loading) {
    return (
      <div className="flex flex-col gap-6 text-neutral-100">
        <div>
          <p className="text-sm uppercase text-neutral-300">AI Quick Fact Tester</p>
          <p className="text-sm text-neutral-400">Loading configuration...</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase text-neutral-300">AI Quick Fact Tester</p>
          <p className="text-sm text-neutral-400">
            Configure and test the quick fact overlay triggered by pressing <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-xs font-mono">Q</kbd> in the player.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          )}
          <button
            onClick={handleReset}
            disabled={saving}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-neutral-300 transition hover:bg-white/10 disabled:opacity-50"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="rounded-md border border-emerald-300/50 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className={`rounded-md border px-3 py-2 text-sm ${
          saveMessage.startsWith("Failed")
            ? "border-red-500/30 bg-red-500/10 text-red-200"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        }`}>
          {saveMessage}
        </div>
      )}

      {/* Auto-play on Channel Switch */}
      <div className={`rounded-md border p-4 transition-colors ${
        draftAutoPlayOnChannelSwitch
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-white/10 bg-neutral-900/60"
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-neutral-100">Auto-play Quick Fact on Channel Switch</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                draftAutoPlayOnChannelSwitch
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-neutral-500/20 text-neutral-400"
              }`}>
                {draftAutoPlayOnChannelSwitch ? "ON" : "OFF"}
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              When enabled, all users will automatically receive a Quick Fact a few seconds after tuning to a new channel — as if Q was pressed automatically.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {draftAutoPlayOnChannelSwitch && (
              <select
                value={draftAutoPlayDelaySeconds}
                onChange={(e) => setDraftAutoPlayDelaySeconds(Number(e.target.value))}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-400"
              >
                {AUTO_PLAY_DELAY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-neutral-900">
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
            <button
              role="switch"
              aria-checked={draftAutoPlayOnChannelSwitch}
              onClick={() => setDraftAutoPlayOnChannelSwitch((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                draftAutoPlayOnChannelSwitch ? "bg-emerald-500" : "bg-neutral-600"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                  draftAutoPlayOnChannelSwitch ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Context Variables */}
      <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold text-neutral-300">Context Variables</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              Choose which metadata fields are sent to the AI. Affects <code className="text-emerald-400/80">{"{{metaContext}}"}</code> and all individual variable substitutions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDraftEnabledVars(DEFAULT_ENABLED_VARS)}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition"
            >
              All on
            </button>
            <span className="text-neutral-700">·</span>
            <button
              onClick={() => setDraftEnabledVars(
                Object.fromEntries(Object.keys(DEFAULT_ENABLED_VARS).map((k) => [k, false])) as EnabledVars
              )}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition"
            >
              All off
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {VAR_DEFINITIONS.map(({ key, label, templateVars, description }) => {
            const enabled = draftEnabledVars[key];
            return (
              <label
                key={key}
                className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
                  enabled
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-white/8 bg-white/3 opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) =>
                    setDraftEnabledVars((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded border-neutral-600 bg-neutral-800 accent-emerald-500"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-neutral-200">{label}</span>
                    {templateVars.map((v) => (
                      <code key={v} className="rounded bg-white/8 px-1 py-0.5 text-[10px] text-emerald-400/80 font-mono">{v}</code>
                    ))}
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-0.5 leading-snug">{description}</p>
                </div>
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-neutral-600">
          Disabled fields are excluded from <code className="text-neutral-500">{"{{metaContext}}"}</code> and their template variables are substituted with an empty string.
        </p>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Model */}
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <label className="block text-xs text-neutral-400 mb-2">Model</label>
          <select
            value={draftModel}
            onChange={(e) => setDraftModel(e.target.value)}
            className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400"
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-neutral-900">
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Max Tokens */}
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <label className="block text-xs text-neutral-400 mb-2">Max Tokens</label>
          <select
            value={draftMaxTokens}
            onChange={(e) => setDraftMaxTokens(Number(e.target.value))}
            className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400"
          >
            {TOKEN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-neutral-900">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Hold Duration */}
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <label className="block text-xs text-neutral-400 mb-2">Hold Duration (after typing)</label>
          <select
            value={draftHoldSeconds}
            onChange={(e) => setDraftHoldSeconds(Number(e.target.value))}
            className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400"
          >
            {HOLD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-neutral-900">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Typing Speed */}
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <label className="block text-xs text-neutral-400 mb-2">Typing Speed (ms / char)</label>
          <select
            value={draftTypingSpeedMs}
            onChange={(e) => setDraftTypingSpeedMs(Number(e.target.value))}
            className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400"
          >
            {TYPING_SPEED_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-neutral-900">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Overlay Width */}
        <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
          <label className="block text-xs text-neutral-400 mb-2">Overlay Width</label>
          <select
            value={draftWidthVw}
            onChange={(e) => setDraftWidthVw(Number(e.target.value))}
            className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400"
          >
            {WIDTH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-neutral-900">
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Prompt Editor */}
      <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-neutral-400">System Prompt Template</label>
          <div className="text-right text-xs text-neutral-500">
            <div>
              Active substitutions:{" "}
              {enabledTemplateVars.length > 0 ? (
                enabledTemplateVars.map((v) => (
                  <code key={v} className="text-emerald-400/80 ml-1">{v}</code>
                ))
              ) : (
                <span className="text-neutral-600">(none)</span>
              )}
              {" "}
              <code className="text-emerald-400/80 ml-1">{"{{metaContext}}"}</code>
              {!hasAnyEnabledContextVar && (
                <span className="text-neutral-600 ml-1">(empty)</span>
              )}
            </div>
            {disabledTemplateVars.length > 0 && (
              <div className="mt-1 text-neutral-600">
                Disabled:{" "}
                {disabledTemplateVars.map((v) => (
                  <code key={v} className="ml-1">{v}</code>
                ))}
              </div>
            )}
          </div>
        </div>
        <textarea
          value={draftPrompt}
          onChange={(e) => setDraftPrompt(e.target.value)}
          rows={6}
          className="w-full resize-y rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 font-mono placeholder:text-neutral-500 outline-none focus:border-emerald-400"
        />
      </div>

      {/* Test Section */}
      <div className="rounded-md border border-white/10 bg-neutral-900/60 p-4">
        <p className="text-xs text-neutral-400 mb-3">Test with media from library</p>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-neutral-500 mb-1">Select Media</label>
            <select
              value={selectedMedia}
              onChange={(e) => {
                setSelectedMedia(e.target.value);
                setTestResult(null);
              }}
              disabled={mediaLoading}
              className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400 disabled:opacity-50"
            >
              {mediaLoading && <option className="bg-neutral-900">Loading media...</option>}
              {mediaItems.map((item) => (
                <option key={item.relPath} value={item.relPath} className="bg-neutral-900">
                  {item.title || item.relPath}
                  {item.year ? ` (${item.year})` : ""}
                  {item.type ? ` [${item.type}]` : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleTest}
            disabled={testRunning || !selectedMedia}
            className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {testRunning ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-neutral-900/30 border-t-neutral-900 rounded-full animate-spin" />
                Running
              </span>
            ) : (
              "Run Test"
            )}
          </button>
        </div>

        {/* Playback position slider */}
        {selectedMediaItem && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-neutral-500">Simulated playback position</label>
              <span className="text-xs text-neutral-400 font-mono tabular-nums">
                {formatSeconds(Math.round((playbackPercent / 100) * (selectedMediaItem.durationSeconds || 7200)))}
                {" / "}
                {formatSeconds(selectedMediaItem.durationSeconds || 7200)}
                {" "}({Math.round(playbackPercent)}%)
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={playbackPercent}
              onChange={(e) => setPlaybackPercent(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/10 accent-emerald-500"
            />
            <div className="flex justify-between text-xs text-neutral-600 mt-1">
              <span>0:00</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>{formatSeconds(selectedMediaItem.durationSeconds || 7200)}</span>
            </div>
          </div>
        )}

        {/* Selected media metadata preview */}
        {selectedMediaItem && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-500">
            {selectedMediaItem.director && <span>Dir: {selectedMediaItem.director}</span>}
            {selectedMediaItem.type && (
              <span className={`rounded-full px-2 py-0.5 ${
                selectedMediaItem.type === "film" ? "bg-purple-500/20 text-purple-300" :
                selectedMediaItem.type === "tv" ? "bg-blue-500/20 text-blue-300" :
                selectedMediaItem.type === "documentary" ? "bg-amber-500/20 text-amber-300" :
                selectedMediaItem.type === "sports" ? "bg-green-500/20 text-green-300" :
                selectedMediaItem.type === "concert" ? "bg-pink-500/20 text-pink-300" :
                "bg-neutral-500/20 text-neutral-300"
              }`}>
                {selectedMediaItem.type}
              </span>
            )}
            {selectedMediaItem.category && <span>{selectedMediaItem.category}</span>}
            {selectedMediaItem.tags?.slice(0, 4).map((t, i) => (
              <span key={i} className="rounded-full bg-white/10 px-2 py-0.5">{t}</span>
            ))}
          </div>
        )}

        {/* Test Result */}
        {testResult !== null && (
          <div className="mt-4 rounded-md border border-white/10 bg-black p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-neutral-400">
                {testStreaming ? "Streaming..." : previewDisplay !== null && previewDisplay.length < testResult.length ? "Typing..." : "Result"}
              </span>
              <div className="flex items-center gap-3">
                {!testStreaming && previewDisplay !== null && previewDisplay.length >= testResult.length && (
                  <button
                    onClick={() => {
                      if (previewTypewriterRef.current) clearTimeout(previewTypewriterRef.current);
                      setPreviewDisplay("");
                      let i = 0;
                      const tick = () => {
                        i++;
                        setPreviewDisplay(testResult.slice(0, i));
                        if (i < testResult.length) {
                          previewTypewriterRef.current = setTimeout(tick, draftTypingSpeedMs);
                        }
                      };
                      tick();
                    }}
                    className="text-xs text-neutral-500 hover:text-neutral-300 transition"
                  >
                    ↺ Replay
                  </button>
                )}
                <span className="text-xs text-neutral-500 font-mono tabular-nums">
                  {testResult.length} chars
                </span>
              </div>
            </div>

            {/* CRT-style preview */}
            <div className="relative rounded bg-neutral-950 border border-white/5 p-4 overflow-hidden">
              <div style={{ maxWidth: `${draftWidthVw}vw` }}>
                <p
                  className="text-xl leading-relaxed font-homevideo"
                  style={{ color: "#d4d4d4" }}
                >
                  {testStreaming ? testResult : (previewDisplay ?? "")}
                  {(testStreaming || (previewDisplay !== null && previewDisplay.length < testResult.length)) && (
                    <span className="ml-0.5 animate-pulse">▌</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Interpolated prompt preview */}
      {selectedMediaItem && (
        <details className="rounded-md border border-white/10 bg-neutral-900/60">
          <summary className="cursor-pointer px-4 py-3 text-xs text-neutral-400 hover:text-neutral-200 select-none">
            Preview interpolated prompt
          </summary>
          <div className="px-4 pb-4">
            <pre className="whitespace-pre-wrap text-xs text-neutral-500 font-mono leading-relaxed">
              {interpolatePrompt(draftPrompt, selectedMediaItem, playbackPercent, draftEnabledVars)}
            </pre>
          </div>
        </details>
      )}

      {requestPreview && (
        <details className="rounded-md border border-white/10 bg-neutral-900/60">
          <summary className="cursor-pointer px-4 py-3 text-xs text-neutral-400 hover:text-neutral-200 select-none">
            Preview outgoing request (exact payload)
          </summary>
          <div className="px-4 pb-4 space-y-3">
            <div>
              <p className="text-xs text-neutral-500 mb-1">Enabled context variables</p>
              <p className="text-xs text-emerald-300 font-mono">
                {requestPreview.enabledKeys.length > 0 ? requestPreview.enabledKeys.join(", ") : "(none)"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">Disabled context variables</p>
              <p className="text-xs text-neutral-400 font-mono">
                {requestPreview.disabledKeys.length > 0 ? requestPreview.disabledKeys.join(", ") : "(none)"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">User message sent</p>
              <pre className="whitespace-pre-wrap text-xs text-neutral-300 font-mono leading-relaxed">
                {requestPreview.userMsg}
              </pre>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1">System note sent</p>
              <pre className="whitespace-pre-wrap text-xs text-neutral-500 font-mono leading-relaxed">
                {requestPreview.systemNote}
              </pre>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
