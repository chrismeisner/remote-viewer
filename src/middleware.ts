import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/** Emails allowed to access /admin (mirrors the list in authOptions) */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only gate /admin routes
  if (pathname.startsWith("/admin")) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    // Not signed in → redirect to /login
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Signed in but not an admin → deny
    if (
      ADMIN_EMAILS.length > 0 &&
      !ADMIN_EMAILS.includes((token.email as string)?.toLowerCase() ?? "")
    ) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "AccessDenied");
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
