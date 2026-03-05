import { NextRequest, NextResponse } from "next/server";
import { createWatchToken, resolveWatchToken } from "@/lib/watchTokens";

// POST /api/watch-token — create a token for a file+source pair
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { file, source } = body as { file?: string; source?: string };

    if (!file) {
      return NextResponse.json(
        { error: "file is required" },
        { status: 400 },
      );
    }

    const resolvedSource = source === "local" ? "local" : "remote";
    const token = createWatchToken(file, resolvedSource);
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json(
      { error: "Failed to create watch token" },
      { status: 500 },
    );
  }
}

// GET /api/watch-token?token=xxx — resolve a token to file+source
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "token query param is required" },
      { status: 400 },
    );
  }

  const entry = resolveWatchToken(token);
  if (!entry) {
    return NextResponse.json(
      { error: "Token not found or expired" },
      { status: 404 },
    );
  }

  return NextResponse.json(entry);
}
