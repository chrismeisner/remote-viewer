import { NextResponse } from "next/server";
import {
  isFtpConfigured,
  downloadJsonFromFtp,
  uploadJsonToFtp,
  requireFtpConfig,
  getRemoteBaseDir,
} from "@/lib/ftp";
import path from "node:path";
import { Client } from "basic-ftp";
import { Writable } from "node:stream";

export const runtime = "nodejs";

type ScheduleData = {
  channels: Record<string, {
    type?: "24hour" | "looping";
    slots?: unknown[];
    playlist?: unknown[];
    shortName?: string;
    active?: boolean;
  }>;
};

/**
 * POST /api/channels/repair
 * 
 * Attempts to repair a corrupted schedule.json file on the FTP server.
 * This endpoint:
 * 1. Downloads the raw content of schedule.json
 * 2. Attempts to extract valid JSON from potentially corrupted content
 * 3. Backs up the corrupted file
 * 4. Writes the repaired content
 */
export async function POST() {
  console.log("[Repair API] Starting repair process...");

  if (!isFtpConfigured()) {
    return NextResponse.json({ error: "FTP not configured" }, { status: 400 });
  }

  const { host, user, password, port, remotePath, secure } = requireFtpConfig();
  const baseDir = getRemoteBaseDir(remotePath);
  const targetPath = path.posix.join(baseDir, "schedule.json");
  const backupPath = path.posix.join(baseDir, `schedule.backup.${Date.now()}.json`);

  const client = new Client(15000);
  
  try {
    await client.access({ host, port, user, password, secure });
    
    // Step 1: Download raw content
    console.log("[Repair API] Downloading raw content...");
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    
    await client.downloadTo(writable, targetPath);
    const rawContent = Buffer.concat(chunks).toString("utf8");
    console.log("[Repair API] Raw content length:", rawContent.length);
    
    // Step 2: Try to parse as-is first
    let schedule: ScheduleData | null = null;
    let wasCorrupted = false;
    
    try {
      schedule = JSON.parse(rawContent);
      console.log("[Repair API] File is valid JSON, no repair needed");
    } catch (parseError) {
      wasCorrupted = true;
      console.log("[Repair API] File is corrupted, attempting repair...");
      console.log("[Repair API] Parse error:", parseError instanceof Error ? parseError.message : parseError);
      
      // Step 3: Try to extract valid JSON
      // Look for the first complete JSON object
      schedule = attemptJsonRepair(rawContent);
    }
    
    if (!schedule) {
      return NextResponse.json({ 
        error: "Could not repair schedule.json - manual intervention required",
        rawContentPreview: rawContent.slice(0, 500),
        rawContentLength: rawContent.length,
      }, { status: 500 });
    }
    
    // Validate the structure
    if (!schedule.channels || typeof schedule.channels !== "object") {
      return NextResponse.json({ 
        error: "Repaired JSON doesn't have valid channels structure",
        schedule,
      }, { status: 500 });
    }
    
    const channelCount = Object.keys(schedule.channels).length;
    console.log("[Repair API] Extracted", channelCount, "channels");
    
    if (wasCorrupted) {
      // Step 4: Backup corrupted file
      console.log("[Repair API] Backing up corrupted file to:", backupPath);
      const { Readable } = require("stream");
      const backupStream = Readable.from([rawContent]);
      await client.uploadFrom(backupStream, backupPath);
      
      // Step 5: Write repaired content
      console.log("[Repair API] Writing repaired schedule.json...");
      await uploadJsonToFtp("schedule.json", schedule);
    }
    
    return NextResponse.json({
      success: true,
      wasCorrupted,
      channelCount,
      channels: Object.keys(schedule.channels),
      backupPath: wasCorrupted ? backupPath : null,
      message: wasCorrupted 
        ? `Repaired schedule.json - recovered ${channelCount} channels. Backup saved to ${backupPath}`
        : `Schedule.json is valid - ${channelCount} channels found`,
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Repair API] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.close();
  }
}

/**
 * Attempt to repair corrupted JSON by finding the largest valid JSON object.
 */
function attemptJsonRepair(content: string): ScheduleData | null {
  // Strategy 1: Find matching braces for the first { and extract that object
  const firstBrace = content.indexOf("{");
  if (firstBrace === -1) return null;
  
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = firstBrace; i < content.length; i++) {
    const char = content[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) {
        // Found complete object
        const candidate = content.slice(firstBrace, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === "object" && "channels" in parsed) {
            console.log("[Repair API] Found valid JSON at positions", firstBrace, "-", i + 1);
            return parsed as ScheduleData;
          }
        } catch {
          // Keep looking
        }
      }
    }
  }
  
  // Strategy 2: Try progressively shorter substrings from the end
  for (let end = content.length; end > 100; end -= 100) {
    const candidate = content.slice(0, end);
    // Try to close any open braces
    const openBraces = (candidate.match(/{/g) || []).length;
    const closeBraces = (candidate.match(/}/g) || []).length;
    const missing = openBraces - closeBraces;
    
    if (missing >= 0 && missing < 10) {
      const fixed = candidate + "}".repeat(missing);
      try {
        const parsed = JSON.parse(fixed);
        if (parsed && typeof parsed === "object" && "channels" in parsed) {
          console.log("[Repair API] Repaired by truncating at", end, "and adding", missing, "closing braces");
          return parsed as ScheduleData;
        }
      } catch {
        // Keep trying
      }
    }
  }
  
  return null;
}

/**
 * GET /api/channels/repair
 * 
 * Check the status of schedule.json without modifying it.
 */
export async function GET() {
  console.log("[Repair API] Checking schedule.json status...");

  if (!isFtpConfigured()) {
    return NextResponse.json({ error: "FTP not configured" }, { status: 400 });
  }

  try {
    const schedule = await downloadJsonFromFtp<ScheduleData>("schedule.json");
    
    if (schedule === null) {
      return NextResponse.json({
        status: "not_found",
        message: "schedule.json does not exist",
      });
    }
    
    const channelCount = Object.keys(schedule.channels || {}).length;
    
    return NextResponse.json({
      status: "ok",
      message: `schedule.json is valid with ${channelCount} channels`,
      channelCount,
      channels: Object.keys(schedule.channels || {}),
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    
    if (message.includes("JSON") || message.includes("parse") || message.includes("Unexpected")) {
      return NextResponse.json({
        status: "corrupted",
        message: `schedule.json is corrupted: ${message}`,
        error: message,
      });
    }
    
    return NextResponse.json({
      status: "error",
      message: `Error checking schedule.json: ${message}`,
      error: message,
    }, { status: 500 });
  }
}
