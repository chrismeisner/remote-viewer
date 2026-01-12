import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simplified middleware - no authentication required
// This improves browser compatibility by avoiding cookie/session checks
export function middleware(request: NextRequest) {
  // Allow all requests through
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
