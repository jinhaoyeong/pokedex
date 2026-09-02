import { NextResponse } from "next/server";

import { runWarmSearchJobs } from "@/lib/warm-search.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() || process.env.ADMIN_SECRET_KEY?.trim();
  const authorization = request.headers.get("authorization");

  if (secret) {
    return authorization === `Bearer ${secret}`;
  }

  return request.headers.get("x-vercel-cron") === "1" || process.env.NODE_ENV !== "production";
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runWarmSearchJobs();
    console.info("warm-search cron", {
      planned: result.planned,
      warmed: result.warmed.length,
      skipped: result.skipped,
      failed: result.failed.length,
      elapsedMs: result.elapsedMs,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("warm-search cron failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Warm search failed" },
      { status: 500 },
    );
  }
}
