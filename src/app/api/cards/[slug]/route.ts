import { NextResponse } from "next/server";

import { getCardCatalogCached } from "@/lib/card-catalog";
import { getCardBySlug } from "@/lib/cards";

export const maxDuration = 20;

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const { card, lookupFailed, source } = await getCardCatalogCached(slug, false);

  if (card) {
    return NextResponse.json(
      { card, source: source ?? (getCardBySlug(slug) ? "local" : "live") },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  }

  if (lookupFailed) {
    return NextResponse.json({ error: "Card lookup failed" }, { status: 503 });
  }

  return NextResponse.json({ error: "Card not found" }, { status: 404 });
}
