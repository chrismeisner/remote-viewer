import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { isFtpConfigured, readJsonFromFtpWithLock, writeJsonToFtpWithLock } from "@/lib/ftp";
import type { MediaSource } from "@/constants/media";

const CONFIG_PATH = path.join(process.cwd(), "data", "local", "quick-fact-config.json");
const REMOTE_CONFIG_FILE = "quick-fact-config.json";

export type EnabledVars = {
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

export const DEFAULT_ENABLED_VARS: EnabledVars = {
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

export type QuickFactConfig = {
  prompt: string;
  maxTokens: number;
  model: string;
  holdSeconds: number;
  typingSpeedMs: number;
  widthVw: number;
  autoPlayOnChannelSwitch: boolean;
  autoPlayDelaySeconds: number;
  textBackground: boolean;
  enabledVars: EnabledVars;
};

const DEFAULTS: QuickFactConfig = {
  prompt: `You are a text overlay inside a TV player. The viewer just pressed a button to get a quick fact about what they're watching RIGHT NOW. You know the current playback position — use it to identify approximately what scene or moment is happening and give a fact relevant to THAT part of the film/show. Use web search to look up scene-by-scene breakdowns if needed. Respond with ONLY a single short sentence (max 20 words). Do NOT use markdown, bullet points, or multiple sentences. Format: start with a brief scene/moment reference, then "—" and a relevant fact. Example: "The rooftop chase scene — Rutger Hauer improvised the famous 'tears in rain' monologue"`,
  maxTokens: 200,
  model: "gpt-4o",
  holdSeconds: 8,
  typingSpeedMs: 30,
  widthVw: 80,
  autoPlayOnChannelSwitch: false,
  autoPlayDelaySeconds: 5,
  textBackground: false,
  enabledVars: DEFAULT_ENABLED_VARS,
};

async function loadConfig(): Promise<QuickFactConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw) as Partial<QuickFactConfig>;
    return {
      ...DEFAULTS,
      ...saved,
      enabledVars: {
        ...DEFAULT_ENABLED_VARS,
        ...(saved.enabledVars ?? {}),
      },
    };
  } catch {
    return DEFAULTS;
  }
}

function normalizeConfig(saved: Partial<QuickFactConfig>): QuickFactConfig {
  return {
    ...DEFAULTS,
    ...saved,
    enabledVars: {
      ...DEFAULT_ENABLED_VARS,
      ...(saved.enabledVars ?? {}),
    },
  };
}

async function loadRemoteConfig(): Promise<QuickFactConfig> {
  if (!isFtpConfigured()) {
    return loadConfig();
  }
  const saved = await readJsonFromFtpWithLock<Partial<QuickFactConfig> | null>(
    REMOTE_CONFIG_FILE,
    null
  );
  return normalizeConfig(saved ?? {});
}

async function saveConfig(config: QuickFactConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

async function saveRemoteConfig(config: QuickFactConfig): Promise<void> {
  if (!isFtpConfigured()) {
    await saveConfig(config);
    return;
  }
  await writeJsonToFtpWithLock(REMOTE_CONFIG_FILE, config);
}

function getSource(request: NextRequest): MediaSource {
  const sourceParam = request.nextUrl.searchParams.get("source");
  return sourceParam === "remote" || sourceParam === "local" ? sourceParam : "local";
}

export async function GET(request: NextRequest) {
  const source = getSource(request);
  const config = source === "remote" ? await loadRemoteConfig() : await loadConfig();
  return NextResponse.json({ config, defaults: DEFAULTS, source });
}

export async function PUT(request: NextRequest) {
  try {
    const source = getSource(request);
    const body = await request.json();
    const current = source === "remote" ? await loadRemoteConfig() : await loadConfig();
    const updated: QuickFactConfig = {
      prompt: typeof body.prompt === "string" ? body.prompt : current.prompt,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : current.maxTokens,
      model: typeof body.model === "string" ? body.model : current.model,
      holdSeconds: typeof body.holdSeconds === "number" ? body.holdSeconds : current.holdSeconds,
      typingSpeedMs: typeof body.typingSpeedMs === "number" ? body.typingSpeedMs : current.typingSpeedMs,
      widthVw: typeof body.widthVw === "number" ? body.widthVw : current.widthVw,
      autoPlayOnChannelSwitch: typeof body.autoPlayOnChannelSwitch === "boolean" ? body.autoPlayOnChannelSwitch : current.autoPlayOnChannelSwitch,
      autoPlayDelaySeconds: typeof body.autoPlayDelaySeconds === "number" ? body.autoPlayDelaySeconds : current.autoPlayDelaySeconds,
      textBackground: typeof body.textBackground === "boolean" ? body.textBackground : current.textBackground,
      enabledVars: body.enabledVars && typeof body.enabledVars === "object"
        ? { ...DEFAULT_ENABLED_VARS, ...body.enabledVars }
        : current.enabledVars,
    };
    if (source === "remote") {
      await saveRemoteConfig(updated);
    } else {
      await saveConfig(updated);
    }
    return NextResponse.json({ config: updated, source });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save config" },
      { status: 500 }
    );
  }
}
