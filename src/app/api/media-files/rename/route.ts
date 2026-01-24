import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Client } from "basic-ftp";
import { requireFtpConfig, getRemoteBaseDir } from "@/lib/ftp";

export const runtime = "nodejs";

type RenameRequest = {
  oldPath: string;  // e.g., "My Movie (2020).mp4"
  newPath: string;  // e.g., "my-movie-2020.mp4"
};

type RenameResult = {
  success: boolean;
  message: string;
  oldPath?: string;
  newPath?: string;
  manifestUpdated?: boolean;
};

type MediaItem = {
  relPath: string;
  durationSeconds: number;
  format: string;
  supported: boolean;
  supportedViaCompanion: boolean;
  title: string;
  videoCodec?: string;
  audioCodec?: string;
  size?: number;
  modifiedAt?: string;
  probeFailedAt?: string;
  dateAdded?: string;
};

type MediaIndex = {
  generatedAt: string;
  items: MediaItem[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RenameRequest;
    const { oldPath, newPath } = body;

    if (!oldPath || !newPath) {
      return NextResponse.json(
        { success: false, message: "Both oldPath and newPath are required" } satisfies RenameResult,
        { status: 400 }
      );
    }

    if (oldPath === newPath) {
      return NextResponse.json(
        { success: false, message: "Old and new paths are the same" } satisfies RenameResult,
        { status: 400 }
      );
    }

    // Validate paths don't try to escape the media directory
    if (oldPath.includes("..") || newPath.includes("..")) {
      return NextResponse.json(
        { success: false, message: "Invalid path: cannot contain .." } satisfies RenameResult,
        { status: 400 }
      );
    }

    const { host, user, password, port, remotePath, secure } = requireFtpConfig();
    const baseDir = getRemoteBaseDir(remotePath);

    const client = new Client(15000);
    try {
      await client.access({ host, port, user, password, secure });

      // Navigate to the media directory
      if (baseDir && baseDir !== ".") {
        await client.cd(baseDir);
      }

      // Check if old file exists
      const oldDir = path.posix.dirname(oldPath);
      const oldFileName = path.posix.basename(oldPath);
      
      // List the directory to check if file exists
      const listPath = oldDir === "." ? "" : oldDir;
      const fileList = await client.list(listPath || undefined);
      const fileExists = fileList.some(
        (f) => f.name === oldFileName && f.isFile
      );

      if (!fileExists) {
        return NextResponse.json(
          { success: false, message: `File not found: ${oldPath}` } satisfies RenameResult,
          { status: 404 }
        );
      }

      // Check if new file already exists (to prevent accidental overwrite)
      const newDir = path.posix.dirname(newPath);
      const newFileName = path.posix.basename(newPath);
      
      // If directories are different, check the new directory
      let newFileExists = false;
      if (newDir !== oldDir) {
        try {
          const newDirList = await client.list(newDir === "." ? undefined : newDir);
          newFileExists = newDirList.some(
            (f) => f.name === newFileName && f.isFile
          );
        } catch {
          // New directory might not exist, that's okay for now
        }
      } else {
        newFileExists = fileList.some(
          (f) => f.name === newFileName && f.isFile
        );
      }

      if (newFileExists) {
        return NextResponse.json(
          { success: false, message: `Target file already exists: ${newPath}` } satisfies RenameResult,
          { status: 409 }
        );
      }

      // Perform the rename
      // FTP rename works with paths relative to current directory
      await client.rename(oldPath, newPath);

      // Now update the media-index.json to reflect the rename
      let manifestUpdated = false;
      try {
        // Download current media-index.json
        const manifestPath = path.posix.basename(remotePath); // e.g., "media-index.json"
        const chunks: Buffer[] = [];
        
        await client.downloadTo(
          {
            write: (chunk: Buffer) => { chunks.push(chunk); return true; },
            end: () => {},
          } as NodeJS.WritableStream,
          manifestPath
        );
        
        const manifestContent = Buffer.concat(chunks).toString("utf-8");
        const manifest: MediaIndex = JSON.parse(manifestContent);
        
        // Find and update the item with the old path
        const itemIndex = manifest.items.findIndex((item) => item.relPath === oldPath);
        if (itemIndex !== -1) {
          // Update the relPath
          manifest.items[itemIndex].relPath = newPath;
          
          // Also update the title to match the new filename (without extension)
          const newFileName = path.posix.basename(newPath);
          const newTitle = newFileName.replace(/\.[^/.]+$/, "");
          manifest.items[itemIndex].title = newTitle;
          
          // Update generatedAt timestamp
          manifest.generatedAt = new Date().toISOString();
          
          // Upload updated manifest
          const updatedJson = JSON.stringify(manifest, null, 2);
          const stream = Readable.from([updatedJson]);
          await client.uploadFrom(stream, manifestPath);
          
          manifestUpdated = true;
          console.log(`Updated media-index.json: ${oldPath} -> ${newPath}`);
        } else {
          console.warn(`File ${oldPath} not found in media-index.json, manifest not updated`);
        }
      } catch (manifestError) {
        // Log but don't fail the whole operation if manifest update fails
        console.error("Failed to update media-index.json:", manifestError);
      }

      return NextResponse.json({
        success: true,
        message: manifestUpdated 
          ? `Renamed successfully and updated manifest`
          : `Renamed successfully (manifest update skipped)`,
        oldPath,
        newPath,
        manifestUpdated,
      } satisfies RenameResult);
    } finally {
      client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("FTP rename error:", message);
    return NextResponse.json(
      { success: false, message: `Rename failed: ${message}` } satisfies RenameResult,
      { status: 500 }
    );
  }
}
