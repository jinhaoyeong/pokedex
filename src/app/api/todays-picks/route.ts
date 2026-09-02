import { NextResponse } from "next/server";

import { getLiveHomePreview } from "@/lib/preview-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  const preview = await getLiveHomePreview();

  return NextResponse.json(
    {
      pool: preview.pool,
      hero: preview.hero,
      picks: preview.picks,
      source: preview.source,
    },
    {
      headers: {
        "Cache-Control":
          preview.source === "live"
            ? "public, max-age=120, s-maxage=900, stale-while-revalidate=3600"
            : "no-store",
      },
    },
  );
}
