import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = 'remote-viewer-auth';
const AUTH_COOKIE_VALUE = 'authenticated';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Skip middleware for API routes, static files, and admin panel
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/admin')
  ) {
    return NextResponse.next();
  }
  
  // Check if password protection is enabled
  const passwordRequired = Boolean(process.env.VIEWER_PASSWORD);
  
  if (!passwordRequired) {
    // No password required, allow access
    return NextResponse.next();
  }
  
  // Check if user is authenticated via cookie
  const authCookie = request.cookies.get(AUTH_COOKIE_NAME);
  const isAuthenticated = authCookie?.value === AUTH_COOKIE_VALUE;
  
  if (isAuthenticated) {
    // User is authenticated, allow access
    return NextResponse.next();
  }
  
  // User is not authenticated, redirect to auth page (or let client-side handle it)
  // For now, we'll let the page load but the client-side code will show the modal
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
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
