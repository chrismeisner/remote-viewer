import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const TOKEN_STORE_PATH = path.join(process.cwd(), "data", "watch-tokens.json");
const TOKEN_LENGTH = 8; // 8 hex chars = 4 random bytes
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface WatchTokenEntry {
  file: string;
  source: string;
  createdAt: number;
}

type TokenStore = Record<string, WatchTokenEntry>;

function readStore(): TokenStore {
  try {
    if (!fs.existsSync(TOKEN_STORE_PATH)) return {};
    const raw = fs.readFileSync(TOKEN_STORE_PATH, "utf-8");
    return JSON.parse(raw) as TokenStore;
  } catch {
    return {};
  }
}

function writeStore(store: TokenStore): void {
  const dir = path.dirname(TOKEN_STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(TOKEN_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function pruneExpired(store: TokenStore): TokenStore {
  const now = Date.now();
  const pruned: TokenStore = {};
  for (const [token, entry] of Object.entries(store)) {
    if (now - entry.createdAt < TOKEN_TTL_MS) {
      pruned[token] = entry;
    }
  }
  return pruned;
}

export function createWatchToken(file: string, source: string): string {
  const store = pruneExpired(readStore());

  // Reuse existing token if one already exists for this file+source combo
  for (const [token, entry] of Object.entries(store)) {
    if (entry.file === file && entry.source === source) {
      return token;
    }
  }

  // Generate a unique token
  let token: string;
  do {
    token = crypto.randomBytes(TOKEN_LENGTH / 2).toString("hex");
  } while (store[token]);

  store[token] = { file, source, createdAt: Date.now() };
  writeStore(store);
  return token;
}

export function resolveWatchToken(
  token: string,
): { file: string; source: string } | null {
  const store = readStore();
  const entry = store[token];
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.createdAt > TOKEN_TTL_MS) {
    // Clean up and return null
    delete store[token];
    writeStore(store);
    return null;
  }

  return { file: entry.file, source: entry.source };
}
