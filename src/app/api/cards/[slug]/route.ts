import { NextResponse } from "next/server";

import { getCardCatalogCached } from "@/lib/card-catalog";
import { getCardBySlug } from "@/lib/cards";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  let lookup: Awaited<ReturnType<typeof getCardCatalogCached>>;

  try {
    lookup = await getCardCatalogCached(slug, true, {
      enrichGrading: true,
    });
  } catch (error) {
    console.error(`Card API lookup failed for "${slug}"`, error);
    const localCard = getCardBySlug(slug);

    if (localCard) {
      return NextResponse.json(
        { card: localCard, source: "local", degraded: true },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json({ error: "Card lookup failed" }, { status: 503 });
  }

  const { card, lookupFailed, source } = lookup;

  if (card) {
    return NextResponse.json(
      { card, source: source ?? (getCardBySlug(slug) ? "local" : "live") },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  if (lookupFailed) {
    return NextResponse.json({ error: "Card lookup failed" }, { status: 503 });
  }

  return NextResponse.json({ error: "Card not found" }, { status: 404 });
}
