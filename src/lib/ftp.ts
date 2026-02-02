import path from "node:path";
import { Readable } from "node:stream";
import { Client } from "basic-ftp";

// ─────────────────────────────────────────────────────────────────────────────
// FTP Mutex for preventing race conditions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple mutex implementation for serializing FTP operations.
 * This prevents race conditions when multiple requests try to modify the same file.
 */
class FtpMutex {
  private locks = new Map<string, Promise<void>>();
  
  /**
   * Acquire a lock for a specific file.
   * Returns a release function that must be called when done.
   */
  async acquire(filename: string): Promise<() => void> {
    // Wait for any existing lock on this file
    const existingLock = this.locks.get(filename);
    if (existingLock) {
      await existingLock;
    }
    
    // Create a new lock
    let release: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      release = () => {
        this.locks.delete(filename);
        resolve();
      };
    });
    
    this.locks.set(filename, lockPromise);
    return release;
  }
  
  /**
   * Execute a function with exclusive access to a file.
   */
  async withLock<T>(filename: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(filename);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// Global mutex instance for FTP operations
const ftpMutex = new FtpMutex();

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
 * Uses atomic write pattern: write to temp file, then rename to target.
 * This prevents file corruption from concurrent writes or interrupted uploads.
 */
export async function uploadJsonToFtp(
  filename: string,
  data: unknown
): Promise<string> {
  const { host, user, password, port, remotePath, secure } = requireFtpConfig();

  const json = JSON.stringify(data, null, 2);
  
  // Validate JSON can be parsed back (catch serialization issues)
  try {
    JSON.parse(json);
  } catch (e) {
    throw new Error(`[FTP Upload] Invalid JSON data - would corrupt file: ${e}`);
  }
  
  const baseDir = getRemoteBaseDir(remotePath);
  const targetPath = path.posix.join(baseDir, filename);
  // Use a unique temp filename to avoid conflicts
  const tempPath = path.posix.join(baseDir, `.${filename}.${Date.now()}.tmp`);

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    if (baseDir && baseDir !== ".") {
      await client.ensureDir(baseDir);
    }
    
    // Step 1: Upload to temp file
    const stream = Readable.from([json]);
    await client.uploadFrom(stream, tempPath);
    console.log(`[FTP Upload] Uploaded to temp file: ${tempPath}`);
    
    // Step 2: Atomic rename temp -> target
    // This is atomic on most filesystems, preventing partial writes
    try {
      await client.rename(tempPath, targetPath);
      console.log(`[FTP Upload] Renamed ${tempPath} -> ${targetPath}`);
    } catch (renameError) {
      // If rename fails, try to clean up temp file
      console.error(`[FTP Upload] Rename failed, cleaning up temp file:`, renameError);
      try {
        await client.remove(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw renameError;
    }
    
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

// ─────────────────────────────────────────────────────────────────────────────
// Atomic FTP Operations (Read-Modify-Write with Locking)
// ─────────────────────────────────────────────────────────────────────────────

export type AtomicUpdateOptions = {
  /**
   * If true, throw an error if the file cannot be read (network error, parse error).
   * Only use defaultValue if the file genuinely doesn't exist.
   * This prevents accidental data wipes when the FTP connection fails.
   */
  requireExistingOnError?: boolean;
  /**
   * If true, completely skip using the default value - always require the file to exist.
   * Throws if the file doesn't exist.
   */
  requireExisting?: boolean;
};

/**
 * Result type for safe FTP file reads.
 * Distinguishes between "file doesn't exist" and "error reading file".
 */
type SafeReadResult<T> =
  | { status: "found"; data: T }
  | { status: "not_found" }
  | { status: "error"; error: Error };

/**
 * Safely read a JSON file from FTP, distinguishing between "not found" and "error".
 */
async function safeDownloadJsonFromFtp<T>(filename: string): Promise<SafeReadResult<T>> {
  try {
    const downloaded = await downloadJsonFromFtp<T>(filename);
    if (downloaded === null) {
      return { status: "not_found" };
    }
    return { status: "found", data: downloaded };
  } catch (error) {
    // Check if this is a "file not found" error (550)
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "550" || err?.message?.includes("550") || err?.message?.includes("not found")) {
      return { status: "not_found" };
    }
    // Otherwise, it's a real error (network, parse, etc.)
    return { status: "error", error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Atomically read, modify, and write a JSON file on FTP.
 * This prevents race conditions by:
 * 1. Acquiring a mutex lock
 * 2. Reading directly from FTP (not CDN)
 * 3. Applying the modifier function
 * 4. Writing back to FTP
 * 5. Releasing the lock
 * 
 * IMPORTANT: By default, if the file read fails due to a network error or parse error,
 * this function will use the defaultValue which can cause DATA LOSS. 
 * Use options.requireExistingOnError = true to throw instead.
 * 
 * @param filename - The JSON file to modify (relative to FTP base directory)
 * @param modifier - Function that receives current data and returns modified data
 * @param defaultValue - Default value if file doesn't exist
 * @param options - Safety options to prevent data loss
 * @returns The modified data
 */
export async function atomicJsonUpdate<T>(
  filename: string,
  modifier: (current: T) => T | Promise<T>,
  defaultValue: T,
  options?: AtomicUpdateOptions
): Promise<T> {
  return ftpMutex.withLock(filename, async () => {
    console.log(`[FTP Atomic] Starting atomic update for ${filename}`);
    
    // Read current data directly from FTP (not CDN)
    const readResult = await safeDownloadJsonFromFtp<T>(filename);
    
    let current: T;
    
    switch (readResult.status) {
      case "found":
        current = readResult.data;
        console.log(`[FTP Atomic] Read current data from FTP for ${filename}`);
        break;
        
      case "not_found":
        if (options?.requireExisting) {
          throw new Error(`[FTP Atomic] File ${filename} does not exist and requireExisting is true`);
        }
        console.log(`[FTP Atomic] File ${filename} does not exist, using default value`);
        current = defaultValue;
        break;
        
      case "error":
        // This is critical - if we can't read the file due to an error,
        // using defaultValue could wipe existing data!
        if (options?.requireExistingOnError) {
          console.error(`[FTP Atomic] ERROR reading ${filename}: ${readResult.error.message}`);
          throw new Error(`[FTP Atomic] Failed to read ${filename}: ${readResult.error.message}. Aborting to prevent data loss.`);
        }
        // Legacy behavior: use default (DANGEROUS - can cause data loss!)
        console.warn(`[FTP Atomic] WARNING: Error reading ${filename}, using default. This may cause data loss!`);
        console.warn(`[FTP Atomic] Error was: ${readResult.error.message}`);
        current = defaultValue;
        break;
    }
    
    // Apply modification
    const modified = await modifier(current);
    
    // Write back to FTP
    await uploadJsonToFtp(filename, modified);
    console.log(`[FTP Atomic] Successfully wrote updated data to ${filename}`);
    
    return modified;
  });
}

/**
 * Read a JSON file directly from FTP with locking.
 * Use this instead of fetching from CDN when you need current data.
 * 
 * @param filename - The JSON file to read
 * @param defaultValue - Default value if file doesn't exist
 * @returns The file data or default value
 */
export async function readJsonFromFtpWithLock<T>(
  filename: string,
  defaultValue: T
): Promise<T> {
  return ftpMutex.withLock(filename, async () => {
    const downloaded = await downloadJsonFromFtp<T>(filename);
    return downloaded ?? defaultValue;
  });
}

/**
 * Write a JSON file to FTP with locking.
 * Use this for simple overwrites where you don't need to read first.
 * 
 * @param filename - The JSON file to write
 * @param data - The data to write
 */
export async function writeJsonToFtpWithLock<T>(
  filename: string,
  data: T
): Promise<string> {
  return ftpMutex.withLock(filename, async () => {
    return uploadJsonToFtp(filename, data);
  });
}

// Re-export filename utilities from client-safe module
// These can be used in server code as well
export { cleanupFilename, needsFilenameCleanup } from "./filename-utils";
