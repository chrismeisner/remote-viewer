import { NextRequest, NextResponse } from "next/server";
import {
  listCoverImages,
  saveCoverImage,
  buildCoverUrl,
  getLocalCoversFolderPath,
} from "@/lib/media";
import {
  loadConfig,
  saveConfig,
  getEffectiveCoversFolder,
  validateCoversPath,
  clearConfigCache,
} from "@/lib/config";

export const runtime = "nodejs";

/**
 * GET /api/covers
 * 
 * List all available cover images in the local covers folder.
 * 
 * Query params:
 *   - config=true: Include folder configuration info
 * 
 * Returns:
 *   - covers: array of { filename, url }
 *   - coversFolder: current covers folder path (if config=true)
 *   - isCustomFolder: whether a custom folder is configured (if config=true)
 */
export async function GET(request: NextRequest) {
  try {
    const includeConfig = request.nextUrl.searchParams.get("config") === "true";
    
    const coverFiles = await listCoverImages();
    
    const covers = coverFiles.map((filename) => ({
      filename,
      url: buildCoverUrl(filename),
    }));
    
    const response: Record<string, unknown> = {
      covers,
      count: covers.length,
    };
    
    if (includeConfig) {
      const config = await loadConfig();
      const effectiveFolder = await getEffectiveCoversFolder();
      response.coversFolder = effectiveFolder;
      response.customCoversFolder = config.coversFolder;
      response.isCustomFolder = !!config.coversFolder;
    }
    
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to list covers: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/covers
 * 
 * Upload a new cover image to the local covers folder.
 * 
 * Body: multipart/form-data with:
 *   - file: the image file to upload
 *   - filename: (optional) custom filename to use (otherwise uses original name)
 * 
 * Returns:
 *   - filename: the saved filename
 *   - url: the URL to access the cover
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const customFilename = formData.get("filename");
    
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing required 'file' field" },
        { status: 400 },
      );
    }
    
    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type: ${file.type}. Allowed: ${validTypes.join(", ")}` },
        { status: 400 },
      );
    }
    
    // Determine filename
    let filename = typeof customFilename === "string" && customFilename.trim()
      ? customFilename.trim()
      : file.name;
    
    // Ensure filename has proper extension based on mime type
    const mimeToExt: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
    };
    const expectedExt = mimeToExt[file.type];
    const currentExt = filename.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/)?.[0];
    
    if (!currentExt) {
      filename = filename + expectedExt;
    } else if (currentExt === ".jpeg" && expectedExt === ".jpg") {
      // .jpeg is equivalent to .jpg, allow it
    } else if (currentExt !== expectedExt && !(currentExt === ".jpg" && expectedExt === ".jpg")) {
      // Extension doesn't match mime type - use mime type extension
      filename = filename.replace(/\.[^.]+$/, expectedExt);
    }
    
    // Sanitize filename - remove potentially dangerous characters
    filename = filename
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\.{2,}/g, "_");
    
    // Read file data
    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Size limit: 10MB
    const maxSize = 10 * 1024 * 1024;
    if (buffer.length > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 },
      );
    }
    
    // Save the cover
    const savedFilename = await saveCoverImage(filename, buffer);
    
    return NextResponse.json({
      filename: savedFilename,
      url: buildCoverUrl(savedFilename),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to upload cover: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/covers
 * 
 * Update the covers folder configuration.
 * 
 * Body:
 *   - coversFolder: string | null - path to covers folder, or null to use default
 * 
 * Returns:
 *   - success: boolean
 *   - coversFolder: the effective covers folder path
 *   - isCustomFolder: whether a custom folder is configured
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { coversFolder } = body;
    
    // Load current config
    const config = await loadConfig();
    
    if (coversFolder === null || coversFolder === "") {
      // Clear custom covers folder - use default
      config.coversFolder = null;
    } else if (typeof coversFolder === "string") {
      // Validate the path
      const validation = await validateCoversPath(coversFolder);
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error },
          { status: 400 },
        );
      }
      config.coversFolder = coversFolder;
    } else {
      return NextResponse.json(
        { error: "coversFolder must be a string or null" },
        { status: 400 },
      );
    }
    
    // Save updated config
    await saveConfig(config);
    clearConfigCache();
    
    // Get the effective folder after update
    const effectiveFolder = await getEffectiveCoversFolder();
    
    return NextResponse.json({
      success: true,
      message: config.coversFolder 
        ? `Covers folder set to: ${config.coversFolder}`
        : "Covers folder reset to default",
      coversFolder: effectiveFolder,
      customCoversFolder: config.coversFolder,
      isCustomFolder: !!config.coversFolder,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to update covers folder: ${message}` },
      { status: 500 },
    );
  }
}
