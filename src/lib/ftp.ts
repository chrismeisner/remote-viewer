import path from "node:path";
import { Readable } from "node:stream";
import { Client } from "basic-ftp";

export type FtpConfig = {
  host: string | undefined;
  user: string | undefined;
  password: string | undefined;
  port: number;
  remotePath: string | undefined;
  secure: boolean;
};

export type ValidFtpConfig = {
  host: string;
  user: string;
  password: string;
  port: number;
  remotePath: string;
  secure: boolean;
};

/**
 * Get FTP configuration from environment variables.
 * Returns undefined values if not configured - caller should check.
 */
export function getFtpConfig(): FtpConfig {
  const host = process.env.FTP_HOST?.trim();
  const user = process.env.FTP_USER?.trim();
  const password = process.env.FTP_PASS?.trim();
  const portRaw = process.env.FTP_PORT?.trim();
  const remotePath = process.env.FTP_REMOTE_PATH?.trim();
  const secureRaw = process.env.FTP_SECURE?.trim()?.toLowerCase();
  const port = portRaw ? Number(portRaw) : 21;
  const secure = secureRaw === "true" || secureRaw === "1";
  return { host, user, password, port, remotePath, secure };
}

/**
 * Check if FTP is fully configured.
 */
export function isFtpConfigured(): boolean {
  const { host, user, password, remotePath } = getFtpConfig();
  return !!(host && user && password && remotePath);
}

/**
 * Assert FTP is configured, throwing a descriptive error if not.
 */
export function requireFtpConfig(): ValidFtpConfig {
  const { host, user, password, port, remotePath, secure } = getFtpConfig();
  if (!host || !user || !password || !remotePath) {
    throw new Error(
      "FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH."
    );
  }
  return { host, user, password, port, remotePath, secure };
}

/**
 * Get the base directory from the remote path.
 * e.g., "/media/videos/index.json" -> "/media/videos"
 */
export function getRemoteBaseDir(remotePath: string): string {
  return path.posix.dirname(remotePath);
}

/**
 * Upload JSON data to a file on the FTP server.
 */
export async function uploadJsonToFtp(
  filename: string,
  data: unknown
): Promise<string> {
  const { host, user, password, port, remotePath, secure } = requireFtpConfig();

  const json = JSON.stringify(data, null, 2);
  const baseDir = getRemoteBaseDir(remotePath);
  const targetPath = path.posix.join(baseDir, filename);

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    if (baseDir && baseDir !== ".") {
      await client.ensureDir(baseDir);
    }
    const stream = Readable.from([json]);
    await client.uploadFrom(stream, targetPath);
    return targetPath;
  } finally {
    client.close();
  }
}

/**
 * Normalize a channel ID to safe characters.
 * Removes anything that isn't alphanumeric, underscore, or hyphen.
 */
export function normalizeChannelId(channel?: string): string {
  if (!channel) return "";
  const base = channel.trim();
  if (!base) return "";
  return base.replace(/[^a-zA-Z0-9_-]/g, "-");
}
