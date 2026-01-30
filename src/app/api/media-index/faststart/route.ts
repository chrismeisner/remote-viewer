import { NextRequest, NextResponse } from "next/server";
import { REMOTE_MEDIA_BASE, type MediaSource } from "@/constants/media";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getEffectiveMediaRoot } from "@/lib/config";

export const runtime = "nodejs";

// Maximum bytes to read when checking for moov atom
const PROBE_SIZE = 64 * 1024; // 64KB should be enough to find moov if it's at the start

type FaststartResult = {
  file: string;
  hasFaststart: boolean | null; // null if couldn't determine
  moovPosition: "start" | "end" | "unknown";
  error?: string;
  fileSize?: number;
};

type FaststartResponse = {
  success: boolean;
  source: MediaSource;
  results: FaststartResult[];
  summary: {
    total: number;
    faststart: number;
    needsOptimization: number;
    unknown: number;
  };
  error?: string;
};

/**
 * Check if an MP4 file has faststart (moov atom at the beginning).
 * 
 * MP4 file structure:
 * - Files have "atoms" (also called "boxes")
 * - The moov atom contains all metadata (where frames are, keyframes, etc.)
 * - If moov is at the END, browser must fetch end first, then seek back
 * - If moov is at the START (faststart), browser can start playing immediately
 * 
 * We check by looking at the first ~64KB for the moov atom signature.
 */
async function checkFaststartRemote(url: string): Promise<FaststartResult> {
  const file = url.split("/").pop() || url;
  
  try {
    // First, get file size with HEAD request
    const headRes = await fetch(url, { method: "HEAD" });
    if (!headRes.ok) {
      return { file, hasFaststart: null, moovPosition: "unknown", error: `HTTP ${headRes.status}` };
    }
    
    const contentLength = headRes.headers.get("content-length");
    const fileSize = contentLength ? parseInt(contentLength, 10) : undefined;
    
    // Fetch the first PROBE_SIZE bytes to look for moov
    const rangeRes = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_SIZE - 1}` },
    });
    
    if (!rangeRes.ok && rangeRes.status !== 206) {
      return { file, hasFaststart: null, moovPosition: "unknown", error: `HTTP ${rangeRes.status}`, fileSize };
    }
    
    const buffer = await rangeRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    // Look for atom signatures in the first bytes
    // Atoms have format: [4 bytes size][4 bytes type]
    // Common atoms: ftyp (file type), moov (metadata), mdat (media data)
    
    const atoms = parseAtoms(bytes);
    
    // Check if moov is in the first chunk
    const hasMoov = atoms.some(a => a.type === "moov");
    const hasMdat = atoms.some(a => a.type === "mdat");
    
    // If we found moov before mdat (or moov without seeing mdat), it's faststart
    if (hasMoov) {
      const moovIndex = atoms.findIndex(a => a.type === "moov");
      const mdatIndex = atoms.findIndex(a => a.type === "mdat");
      
      // moov found before mdat = faststart
      if (mdatIndex === -1 || moovIndex < mdatIndex) {
        return { file, hasFaststart: true, moovPosition: "start", fileSize };
      }
    }
    
    // If we found mdat but no moov in the first 64KB, moov is likely at the end
    if (hasMdat && !hasMoov) {
      return { file, hasFaststart: false, moovPosition: "end", fileSize };
    }
    
    // If we only found ftyp or nothing useful, check the end of the file
    if (fileSize && fileSize > PROBE_SIZE) {
      const endStart = Math.max(0, fileSize - PROBE_SIZE);
      const endRes = await fetch(url, {
        headers: { Range: `bytes=${endStart}-${fileSize - 1}` },
      });
      
      if (endRes.ok || endRes.status === 206) {
        const endBuffer = await endRes.arrayBuffer();
        const endBytes = new Uint8Array(endBuffer);
        const endAtoms = parseAtoms(endBytes);
        
        if (endAtoms.some(a => a.type === "moov")) {
          return { file, hasFaststart: false, moovPosition: "end", fileSize };
        }
      }
    }
    
    return { file, hasFaststart: null, moovPosition: "unknown", fileSize };
  } catch (error) {
    return { 
      file, 
      hasFaststart: null, 
      moovPosition: "unknown", 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

/**
 * Check if a local MP4 file has faststart by reading bytes directly from disk.
 */
async function checkFaststartLocal(relPath: string, mediaRoot: string): Promise<FaststartResult> {
  const file = relPath.split("/").pop() || relPath;
  const absPath = path.join(mediaRoot, relPath);
  
  try {
    // Get file stats
    const stats = await fs.stat(absPath);
    const fileSize = stats.size;
    
    // Open file and read first PROBE_SIZE bytes
    const fileHandle = await fs.open(absPath, "r");
    try {
      const buffer = Buffer.alloc(Math.min(PROBE_SIZE, fileSize));
      await fileHandle.read(buffer, 0, buffer.length, 0);
      const bytes = new Uint8Array(buffer);
      
      // Parse atoms from the beginning
      const atoms = parseAtoms(bytes);
      
      // Check if moov is in the first chunk
      const hasMoov = atoms.some(a => a.type === "moov");
      const hasMdat = atoms.some(a => a.type === "mdat");
      
      // If we found moov before mdat (or moov without seeing mdat), it's faststart
      if (hasMoov) {
        const moovIndex = atoms.findIndex(a => a.type === "moov");
        const mdatIndex = atoms.findIndex(a => a.type === "mdat");
        
        // moov found before mdat = faststart
        if (mdatIndex === -1 || moovIndex < mdatIndex) {
          return { file, hasFaststart: true, moovPosition: "start", fileSize };
        }
      }
      
      // If we found mdat but no moov in the first bytes, moov is likely at the end
      if (hasMdat && !hasMoov) {
        return { file, hasFaststart: false, moovPosition: "end", fileSize };
      }
      
      // Check the end of the file if we couldn't determine
      if (fileSize > PROBE_SIZE) {
        const endStart = Math.max(0, fileSize - PROBE_SIZE);
        const endBuffer = Buffer.alloc(fileSize - endStart);
        await fileHandle.read(endBuffer, 0, endBuffer.length, endStart);
        const endBytes = new Uint8Array(endBuffer);
        const endAtoms = parseAtoms(endBytes);
        
        if (endAtoms.some(a => a.type === "moov")) {
          return { file, hasFaststart: false, moovPosition: "end", fileSize };
        }
      }
      
      return { file, hasFaststart: null, moovPosition: "unknown", fileSize };
    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    return {
      file,
      hasFaststart: null,
      moovPosition: "unknown",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Parse MP4 atoms from a byte buffer.
 * Returns array of { type, offset, size } for each atom found.
 */
function parseAtoms(bytes: Uint8Array): Array<{ type: string; offset: number; size: number }> {
  const atoms: Array<{ type: string; offset: number; size: number }> = [];
  let offset = 0;
  
  while (offset + 8 <= bytes.length) {
    // Atom size is first 4 bytes (big-endian)
    const size = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    
    // Atom type is next 4 bytes (ASCII)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    
    // Validate: size should be reasonable and type should be printable ASCII
    if (size < 8 || size > 0x7FFFFFFF || !/^[a-zA-Z0-9 ]{4}$/.test(type)) {
      break;
    }
    
    atoms.push({ type, offset, size });
    
    // Move to next atom
    // Handle size=0 (extends to EOF) and size=1 (64-bit size follows)
    if (size === 0) break;
    if (size === 1) {
      // 64-bit size - skip for now
      offset += 16;
    } else {
      offset += size;
    }
    
    // Safety: don't go past the buffer
    if (offset > bytes.length) break;
  }
  
  return atoms;
}

export async function GET(request: NextRequest) {
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source: MediaSource = sourceParam === "local" ? "local" : "remote";
  const fileParam = request.nextUrl.searchParams.get("file"); // Optional: check specific file
  
  try {
    if (source === "local") {
      // Get media root for local files
      const mediaRoot = await getEffectiveMediaRoot();
      if (!mediaRoot) {
        return NextResponse.json({
          success: false,
          source: "local",
          results: [],
          summary: { total: 0, faststart: 0, needsOptimization: 0, unknown: 0 },
          error: "No media folder configured for local source",
        });
      }
      
      // If specific file requested, check just that one
      if (fileParam) {
        const result = await checkFaststartLocal(fileParam, mediaRoot);
        
        return NextResponse.json({
          success: true,
          source,
          results: [result],
          summary: {
            total: 1,
            faststart: result.hasFaststart === true ? 1 : 0,
            needsOptimization: result.hasFaststart === false ? 1 : 0,
            unknown: result.hasFaststart === null ? 1 : 0,
          },
        });
      }
      
      // Load local media index
      const { getLocalMediaIndexFilePath } = await import("@/lib/media");
      const indexPath = await getLocalMediaIndexFilePath();
      
      if (!indexPath) {
        return NextResponse.json({
          success: false,
          source: "local",
          results: [],
          summary: { total: 0, faststart: 0, needsOptimization: 0, unknown: 0 },
          error: "No media index found. Scan your media library first.",
        });
      }
      
      let items: Array<{ relPath: string }> = [];
      try {
        const indexData = JSON.parse(await fs.readFile(indexPath, "utf8"));
        items = Array.isArray(indexData?.items) ? indexData.items : [];
      } catch {
        return NextResponse.json({
          success: false,
          source: "local",
          results: [],
          summary: { total: 0, faststart: 0, needsOptimization: 0, unknown: 0 },
          error: "Failed to read media index. Scan your media library first.",
        });
      }
      
      // Filter to only MP4/M4V/MOV files
      const mp4Files = items.filter((item) => {
        const p = item?.relPath?.toLowerCase() || "";
        return p.endsWith(".mp4") || p.endsWith(".m4v") || p.endsWith(".mov");
      });
      
      // Check each file (limit to first 50 to avoid timeout)
      const filesToCheck = mp4Files.slice(0, 50);
      const results: FaststartResult[] = [];
      
      // Check files in batches of 5 for better performance
      const batchSize = 5;
      for (let i = 0; i < filesToCheck.length; i += batchSize) {
        const batch = filesToCheck.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map((item) => checkFaststartLocal(item.relPath, mediaRoot))
        );
        results.push(...batchResults);
      }
      
      // Calculate summary
      const summary = {
        total: results.length,
        faststart: results.filter(r => r.hasFaststart === true).length,
        needsOptimization: results.filter(r => r.hasFaststart === false).length,
        unknown: results.filter(r => r.hasFaststart === null).length,
      };
      
      const response: FaststartResponse = {
        success: true,
        source: "local",
        results,
        summary,
      };
      
      if (mp4Files.length > 50) {
        response.error = `Showing first 50 of ${mp4Files.length} files. Check individual files for complete results.`;
      }
      
      return NextResponse.json(response);
    }
    
    // Remote source - fetch media index and check files
    const base = process.env.REMOTE_MEDIA_BASE || REMOTE_MEDIA_BASE;
    if (!base) {
      return NextResponse.json({
        success: false,
        source,
        results: [],
        summary: { total: 0, faststart: 0, needsOptimization: 0, unknown: 0 },
        error: "REMOTE_MEDIA_BASE not configured",
      });
    }
    
    // If specific file requested, check just that one
    if (fileParam) {
      const url = new URL(fileParam, base).toString();
      const result = await checkFaststartRemote(url);
      
      return NextResponse.json({
        success: true,
        source,
        results: [result],
        summary: {
          total: 1,
          faststart: result.hasFaststart === true ? 1 : 0,
          needsOptimization: result.hasFaststart === false ? 1 : 0,
          unknown: result.hasFaststart === null ? 1 : 0,
        },
      });
    }
    
    // Fetch media index
    const indexUrl = new URL("media-index.json", base).toString();
    const indexRes = await fetch(indexUrl, { cache: "no-store" });
    
    if (!indexRes.ok) {
      return NextResponse.json({
        success: false,
        source,
        results: [],
        summary: { total: 0, faststart: 0, needsOptimization: 0, unknown: 0 },
        error: `Failed to fetch media index: HTTP ${indexRes.status}`,
      });
    }
    
    const indexData = await indexRes.json();
    const items = Array.isArray(indexData?.items) ? indexData.items : [];
    
    // Filter to only MP4/M4V files (most common containers that need faststart)
    const mp4Files = items.filter((item: { relPath?: string }) => {
      const path = item?.relPath?.toLowerCase() || "";
      return path.endsWith(".mp4") || path.endsWith(".m4v") || path.endsWith(".mov");
    });
    
    // Check each file (limit to first 50 to avoid timeout)
    const filesToCheck = mp4Files.slice(0, 50);
    const results: FaststartResult[] = [];
    
    // Check files in batches of 5 for better performance
    const batchSize = 5;
    for (let i = 0; i < filesToCheck.length; i += batchSize) {
      const batch = filesToCheck.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((item: { relPath: string }) => {
          const url = new URL(item.relPath, base).toString();
          return checkFaststartRemote(url);
        })
      );
      results.push(...batchResults);
    }
    
    // Calculate summary
    const summary = {
      total: results.length,
      faststart: results.filter(r => r.hasFaststart === true).length,
      needsOptimization: results.filter(r => r.hasFaststart === false).length,
      unknown: results.filter(r => r.hasFaststart === null).length,
    };
    
    const response: FaststartResponse = {
      success: true,
      source,
      results,
      summary,
    };
    
    if (mp4Files.length > 50) {
      response.error = `Showing first 50 of ${mp4Files.length} files. Check individual files for complete results.`;
    }
    
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({
      success: false,
      source,
      results: [],
      summary: { total: 0, faststart: 0, needsOptimization: 0, unknown: 0 },
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
