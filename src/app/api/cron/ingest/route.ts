import { NextResponse } from "next/server";

import { runCatalogIngest } from "@/lib/ingest/run-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await runCatalogIngest();
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Ingest failed",
      },
      { status: 500 },
    );
  }
}
