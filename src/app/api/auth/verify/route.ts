import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const expectedPassword = process.env.VIEWER_PASSWORD;

    // If no password is configured, allow access
    if (!expectedPassword) {
      return NextResponse.json({ success: true });
    }

    if (password === expectedPassword) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { success: false, error: "Invalid password" },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request" },
      { status: 400 }
    );
  }
}

// Also provide a GET endpoint to check if password is required
export async function GET() {
  const passwordRequired = Boolean(process.env.VIEWER_PASSWORD);
  return NextResponse.json({ passwordRequired });
}
