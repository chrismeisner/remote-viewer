import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_PATH = path.join(process.cwd(), "data", "local", "quick-fact-config.json");

export type QuickFactConfig = {
  prompt: string;
  maxTokens: number;
  model: string;
  holdSeconds: number;
};

const DEFAULTS: QuickFactConfig = {
  prompt: `You are a text overlay inside a TV player. The viewer just pressed a button to get a quick fact about what they're watching RIGHT NOW. You know the current playback position — use it to identify approximately what scene or moment is happening and give a fact relevant to THAT part of the film/show. Use web search to look up scene-by-scene breakdowns if needed. Respond with ONLY a single short sentence (max 20 words). Do NOT use markdown, bullet points, or multiple sentences. Format: start with a brief scene/moment reference, then "—" and a relevant fact. Example: "The rooftop chase scene — Rutger Hauer improvised the famous 'tears in rain' monologue"`,
  maxTokens: 200,
  model: "gpt-4o",
  holdSeconds: 8,
};

async function loadConfig(): Promise<QuickFactConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw) as Partial<QuickFactConfig>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return DEFAULTS;
  }
}

async function saveConfig(config: QuickFactConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json({ config, defaults: DEFAULTS });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const current = await loadConfig();
    const updated: QuickFactConfig = {
      prompt: typeof body.prompt === "string" ? body.prompt : current.prompt,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : current.maxTokens,
      model: typeof body.model === "string" ? body.model : current.model,
      holdSeconds: typeof body.holdSeconds === "number" ? body.holdSeconds : current.holdSeconds,
    };
    await saveConfig(updated);
    return NextResponse.json({ config: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save config" },
      { status: 500 }
    );
  }
}
