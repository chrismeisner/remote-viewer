import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  isLocalMode,
  loadConfig,
  saveConfig,
  getDefaultMediaRoot,
  getEffectiveMediaRoot,
  validateMediaPath,
  clearConfigCache,
} from "@/lib/config";
import { clearMediaCaches } from "@/lib/media";

export const runtime = "nodejs";

export type SourceResponse = {
  mediaRoot: string | null;
  effectiveMediaRoot: string;
  defaultRoot: string;
  localMode: boolean;
  dataFolder: string | null;
};

/**
 * GET /api/source
 * Returns current media root config and local mode status.
 */
export async function GET() {
  try {
    const localMode = isLocalMode();
    const config = await loadConfig();
    const effectiveMediaRoot = await getEffectiveMediaRoot();
    const defaultRoot = getDefaultMediaRoot();

    // Data folder is <mediaRoot>/.remote-viewer/ when custom folder is set
    const dataFolder = config.mediaRoot
      ? path.join(config.mediaRoot, ".remote-viewer")
      : null;

    return NextResponse.json({
      mediaRoot: config.mediaRoot,
      effectiveMediaRoot,
      defaultRoot,
      localMode,
      dataFolder,
    } satisfies SourceResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export type SourceUpdateRequest = {
  mediaRoot: string | null;
};

export type SourceUpdateResponse = {
  success: boolean;
  mediaRoot: string | null;
  effectiveMediaRoot: string;
  dataFolder: string | null;
  message?: string;
};

/**
 * PUT /api/source
 * Update the media root path. Set to null to use default.
 */
export async function PUT(request: NextRequest) {
  try {
    // Only allow in local mode
    if (!isLocalMode()) {
      return NextResponse.json(
        { error: "Cannot change media root when not in local mode" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const mediaRoot = body.mediaRoot;

    // Allow null to reset to default
    if (mediaRoot === null || mediaRoot === "") {
      await saveConfig({ mediaRoot: null });
      clearConfigCache();
      clearMediaCaches();
      
      const effectiveMediaRoot = await getEffectiveMediaRoot();
      return NextResponse.json({
        success: true,
        mediaRoot: null,
        effectiveMediaRoot,
        dataFolder: null,
        message: "Reset to default media folder",
      } satisfies SourceUpdateResponse);
    }

    // Validate the path
    if (typeof mediaRoot !== "string") {
      return NextResponse.json(
        { error: "mediaRoot must be a string path" },
        { status: 400 }
      );
    }

    const resolved = path.resolve(mediaRoot);
    const validation = await validateMediaPath(resolved);

    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Save the config
    await saveConfig({ mediaRoot: resolved });
    clearConfigCache();
    clearMediaCaches();

    const dataFolder = path.join(resolved, ".remote-viewer");

    return NextResponse.json({
      success: true,
      mediaRoot: resolved,
      effectiveMediaRoot: resolved,
      dataFolder,
      message: `Media folder set to ${resolved}`,
    } satisfies SourceUpdateResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
