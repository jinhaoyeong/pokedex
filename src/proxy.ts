import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Auth proxy (Next.js 16 replacement for middleware.ts).
 *
 * The matcher below deliberately excludes every existing /api route so the
 * public pricing APIs (/api/price, /api/live-search, etc.) are never touched
 * by auth middleware. Only the new authenticated portfolio surface is
 * protected; all other pages run clerkMiddleware solely so auth() is
 * available in server components and server actions, without requiring
 * sign-in.
 */

const isProtectedRoute = createRouteMatcher([
  "/portfolio/vault(.*)",
  "/api/portfolio(.*)",
]);

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

const handler = clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        await auth.protect();
      }
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    // All pages except static assets and ALL /api routes (public APIs stay untouched).
    "/((?!api/|_next/|.*\\..*).*)",
    // The only API namespace that goes through auth: the new portfolio API.
    "/api/portfolio/:path*",
  ],
};
