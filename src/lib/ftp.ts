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

/**
 * Download a JSON file from the FTP server.
 * Returns the parsed JSON data, or null if the file doesn't exist.
 */
export async function downloadJsonFromFtp<T = unknown>(
  filename: string
): Promise<T | null> {
  const { host, user, password, port, remotePath, secure } = requireFtpConfig();

  const baseDir = getRemoteBaseDir(remotePath);
  const targetPath = path.posix.join(baseDir, filename);

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    
    // Check if file exists by trying to get its size
    try {
      await client.size(targetPath);
    } catch {
      // File doesn't exist
      return null;
    }
    
    // Download to a writable stream and collect chunks
    const chunks: Buffer[] = [];
    const writable = new (require("stream").Writable)({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        chunks.push(chunk);
        callback();
      },
    });
    
    await client.downloadTo(writable, targetPath);
    const content = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // File not found is not an error, just return null
    if (err?.code === "550" || err?.message?.includes("550")) {
      return null;
    }
    throw error;
  } finally {
    client.close();
  }
}

/**
 * Upload a binary file (e.g., image) to the FTP server.
 * @param subPath - Path relative to the base directory (e.g., "covers/image.jpg")
 * @param data - Buffer containing the file data
 * @returns The full remote path where the file was uploaded
 */
export async function uploadFileToFtp(
  subPath: string,
  data: Buffer
): Promise<string> {
  const { host, user, password, port, remotePath, secure } = requireFtpConfig();

  const baseDir = getRemoteBaseDir(remotePath);
  const targetPath = path.posix.join(baseDir, subPath);
  const targetDir = path.posix.dirname(targetPath);

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    
    // Ensure the directory exists
    if (targetDir && targetDir !== ".") {
      await client.ensureDir(targetDir);
    }
    
    const stream = Readable.from([data]);
    await client.uploadFrom(stream, targetPath);
    return targetPath;
  } finally {
    client.close();
  }
}

/**
 * Check if a directory exists on the FTP server.
 * @param subPath - Path relative to the base directory (e.g., "covers")
 * @returns true if the directory exists, false otherwise
 */
export async function ftpDirectoryExists(subPath: string): Promise<boolean> {
  const { host, user, password, port, remotePath, secure } = requireFtpConfig();

  const baseDir = getRemoteBaseDir(remotePath);
  const targetPath = path.posix.join(baseDir, subPath);

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    
    // Try to change to the directory - this will fail if it doesn't exist
    try {
      await client.cd(targetPath);
      return true;
    } catch {
      return false;
    }
  } finally {
    client.close();
  }
}

/**
 * Ensure a directory exists on the FTP server, creating it if needed.
 * @param subPath - Path relative to the base directory (e.g., "covers")
 * @returns The full remote path of the directory
 */
export async function ensureFtpDirectory(subPath: string): Promise<string> {
  const { host, user, password, port, remotePath, secure } = requireFtpConfig();

  const baseDir = getRemoteBaseDir(remotePath);
  const targetPath = path.posix.join(baseDir, subPath);

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    await client.ensureDir(targetPath);
    return targetPath;
  } finally {
    client.close();
  }
}

/**
 * List files in a directory on the FTP server.
 * @param subPath - Path relative to the base directory (e.g., "covers")
 * @returns Array of filenames in the directory
 */
export async function listFtpDirectory(subPath: string): Promise<string[]> {
  const { host, user, password, port, remotePath, secure } = requireFtpConfig();

  const baseDir = getRemoteBaseDir(remotePath);
  const targetPath = path.posix.join(baseDir, subPath);

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    
    // Try to list the directory
    try {
      const list = await client.list(targetPath);
      return list
        .filter(item => item.type === 1) // Type 1 = file
        .map(item => item.name);
    } catch {
      // Directory doesn't exist or can't be listed
      return [];
    }
  } finally {
    client.close();
  }
}

// Re-export filename utilities from client-safe module
// These can be used in server code as well
export { cleanupFilename, needsFilenameCleanup } from "./filename-utils";
