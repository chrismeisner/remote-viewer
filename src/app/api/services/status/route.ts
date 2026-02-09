import { NextResponse } from "next/server";
import { Client } from "basic-ftp";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceStatus = {
  id: string;
  name: string;
  description: string;
  status: "ok" | "warning" | "error" | "unconfigured";
  message: string;
  latencyMs?: number;
};

// ─── Individual service checks ───────────────────────────────────────────────

async function checkGoogleAuth(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "google-auth",
    name: "Google OAuth",
    description: "Authentication via Google for admin access",
  };

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const secret = process.env.NEXTAUTH_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return { ...base, status: "unconfigured", message: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set" };
  }
  if (!secret) {
    return { ...base, status: "warning", message: "NEXTAUTH_SECRET not set — sessions may not persist across restarts" };
  }

  return { ...base, status: "ok", message: "Configured" };
}

async function checkAdminEmails(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "admin-emails",
    name: "Admin Allow-list",
    description: "ADMIN_EMAILS restricts who can access /admin",
  };

  const raw = process.env.ADMIN_EMAILS?.trim();
  if (!raw) {
    return { ...base, status: "warning", message: "ADMIN_EMAILS not set — any Google account can sign in to admin" };
  }

  const emails = raw.split(",").map((e) => e.trim()).filter(Boolean);
  return { ...base, status: "ok", message: `${emails.length} email(s) on allow-list` };
}

async function checkOpenAI(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "openai",
    name: "OpenAI API",
    description: "Powers the AI agent chat and metadata lookups",
  };

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return { ...base, status: "unconfigured", message: "OPENAI_API_KEY not set" };
  }

  try {
    const start = Date.now();
    const client = new OpenAI({ apiKey: key, timeout: 10_000 });
    // Lightweight call to validate the key
    const models = await client.models.list();
    const latencyMs = Date.now() - start;
    const count = Array.isArray(models.data) ? models.data.length : 0;
    return { ...base, status: "ok", message: `Connected — ${count} models available`, latencyMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("401") || msg.includes("Incorrect API key")) {
      return { ...base, status: "error", message: "Invalid API key" };
    }
    return { ...base, status: "error", message: `Connection failed: ${msg}` };
  }
}

async function checkFTP(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "ftp",
    name: "FTP Server",
    description: "Uploads JSON data and cover images to remote host",
  };

  const host = process.env.FTP_HOST?.trim();
  const user = process.env.FTP_USER?.trim();
  const password = process.env.FTP_PASS?.trim();
  const remotePath = process.env.FTP_REMOTE_PATH?.trim();
  const portRaw = process.env.FTP_PORT?.trim();
  const secureRaw = process.env.FTP_SECURE?.trim()?.toLowerCase();
  const port = portRaw ? Number(portRaw) : 21;
  const secure = secureRaw === "true" || secureRaw === "1";

  if (!host || !user || !password || !remotePath) {
    return { ...base, status: "unconfigured", message: "FTP_HOST, FTP_USER, FTP_PASS, or FTP_REMOTE_PATH not set" };
  }

  const client = new Client(10_000);
  try {
    const start = Date.now();
    await client.access({ host, port, user, password, secure });
    const latencyMs = Date.now() - start;
    return { ...base, status: "ok", message: `Connected to ${host}:${port}`, latencyMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, status: "error", message: `Connection failed: ${msg}` };
  } finally {
    client.close();
  }
}

async function checkRemoteCDN(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "remote-cdn",
    name: "Remote CDN",
    description: "Serves media index, schedules, and video files",
  };

  const remoteBase = process.env.REMOTE_MEDIA_BASE?.trim() || "https://chrismeisner.com/media/";

  try {
    const start = Date.now();
    const res = await fetch(`${remoteBase}media-index.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { ...base, status: "ok", message: `Reachable at ${remoteBase}`, latencyMs };
    }
    return { ...base, status: "warning", message: `HTTP ${res.status} from ${remoteBase}media-index.json`, latencyMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, status: "error", message: `Unreachable: ${msg}` };
  }
}

async function checkGoogleAnalytics(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Tracks page views and player events",
  };

  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  if (!measurementId) {
    return { ...base, status: "unconfigured", message: "NEXT_PUBLIC_GA_MEASUREMENT_ID not set" };
  }

  return { ...base, status: "ok", message: `Measurement ID: ${measurementId}` };
}

async function checkViewerPassword(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "viewer-password",
    name: "Viewer Password",
    description: "Optional password gate for the player page",
  };

  const pw = process.env.VIEWER_PASSWORD?.trim();
  if (!pw) {
    return { ...base, status: "ok", message: "Disabled — player is publicly accessible" };
  }

  return { ...base, status: "ok", message: "Enabled — player requires password" };
}

async function checkLocalMedia(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "local-media",
    name: "Local Media Root",
    description: "MEDIA_ROOT directory for local file scanning",
  };

  const mediaRoot = process.env.MEDIA_ROOT?.trim();
  if (!mediaRoot) {
    return { ...base, status: "unconfigured", message: "MEDIA_ROOT not set — local mode unavailable" };
  }

  // Check if directory exists
  try {
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(mediaRoot);
    if (!stat.isDirectory()) {
      return { ...base, status: "error", message: `${mediaRoot} exists but is not a directory` };
    }
    return { ...base, status: "ok", message: `Directory exists: ${mediaRoot}` };
  } catch {
    return { ...base, status: "error", message: `Directory not found: ${mediaRoot}` };
  }
}

async function checkFfprobe(): Promise<ServiceStatus> {
  const base: Omit<ServiceStatus, "status" | "message"> = {
    id: "ffprobe",
    name: "FFprobe",
    description: "Extracts video duration and metadata",
  };

  const ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe";

  try {
    const { execSync } = await import("node:child_process");
    const version = execSync(`${ffprobePath} -version`, { timeout: 5_000 })
      .toString()
      .split("\n")[0]
      .trim();
    return { ...base, status: "ok", message: version };
  } catch {
    if (process.env.FFPROBE_PATH) {
      return { ...base, status: "error", message: `Not found at ${ffprobePath}` };
    }
    return { ...base, status: "unconfigured", message: "ffprobe not found on PATH and FFPROBE_PATH not set" };
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function GET() {
  // Run all checks in parallel for speed
  const services = await Promise.all([
    checkGoogleAuth(),
    checkAdminEmails(),
    checkOpenAI(),
    checkFTP(),
    checkRemoteCDN(),
    checkGoogleAnalytics(),
    checkViewerPassword(),
    checkLocalMedia(),
    checkFfprobe(),
  ]);

  const summary = {
    ok: services.filter((s) => s.status === "ok").length,
    warning: services.filter((s) => s.status === "warning").length,
    error: services.filter((s) => s.status === "error").length,
    unconfigured: services.filter((s) => s.status === "unconfigured").length,
    total: services.length,
  };

  return NextResponse.json({ services, summary, checkedAt: new Date().toISOString() });
}
