import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE_NAME = "remote-viewer-auth";
const AUTH_COOKIE_VALUE = "authenticated";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const expectedPassword = process.env.VIEWER_PASSWORD;

    // If no password is configured, allow access
    if (!expectedPassword) {
      const response = NextResponse.json({ success: true });
      // Set auth cookie even when no password required for consistency
      response.cookies.set(AUTH_COOKIE_NAME, AUTH_COOKIE_VALUE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
      return response;
    }

    if (password === expectedPassword) {
      const response = NextResponse.json({ success: true });
      // Set secure HTTP-only cookie for authentication
      response.cookies.set(AUTH_COOKIE_NAME, AUTH_COOKIE_VALUE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
      return response;
    }

    return NextResponse.json(
      { success: false, error: "Invalid password" },
      { status: 401 }
    );
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { success: false, error: "Invalid request" },
      { status: 400 }
    );
  }
}

// Also provide a GET endpoint to check if password is required
export async function GET(req: NextRequest) {
  const passwordRequired = Boolean(process.env.VIEWER_PASSWORD);
  
  // Check if already authenticated via cookie
  const authCookie = req.cookies.get(AUTH_COOKIE_NAME);
  const isAuthenticated = authCookie?.value === AUTH_COOKIE_VALUE;
  
  return NextResponse.json({ 
    passwordRequired,
    isAuthenticated: passwordRequired ? isAuthenticated : true
  });
}
