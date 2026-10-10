import { NextResponse, type NextRequest } from "next/server";

// Matches the cookie name in lib/auth-instance.ts. Proxy only checks that the
// cookie exists; the management layout validates the session itself.
const sessionCookieName = "shiftline_session";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(sessionCookieName)) {
    const signInUrl = new URL("/clock", request.url);
    return NextResponse.redirect(signInUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/manage/:path*",
    "/outlets/:path*",
    "/team/:path*",
    "/timesheets/:path*",
    "/corrections/:path*",
  ],
};
