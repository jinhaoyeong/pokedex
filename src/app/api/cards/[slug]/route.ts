import { NextResponse } from "next/server";

import { getCardCatalogCached } from "@/lib/card-catalog";
import { getCardBySlug } from "@/lib/cards";
import { readCachedResponse, writeCachedResponse } from "@/lib/server-response-cache";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Successful card payloads are edge-cacheable for an hour (stale for a day).
// Failed/degraded lookups stay no-store so recovery is visible immediately.
const EDGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const MEMORY_TTL_MS = 5 * 60_000;

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const memoKey = `card:${slug}`;
  const memoized = readCachedResponse<Record<string, unknown>>(memoKey);

  if (memoized) {
    return NextResponse.json(memoized, {
      headers: { "Cache-Control": EDGE_CACHE_CONTROL, "X-Memory-Cache": "hit" },
    });
  }

  let lookup: Awaited<ReturnType<typeof getCardCatalogCached>>;

  try {
    // Deliberately NOT enrichGrading here: population/graded/sold-comp scraping
    // can take 20-40s and must never block the core card payload. The client
    // (useCardGradingMarket) fetches /api/price and /api/grading-market in
    // parallel and merges them after this response has already painted.
    lookup = await getCardCatalogCached(slug, true);
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
    const payload = { card, source: source ?? (getCardBySlug(slug) ? "local" : "live") };
    writeCachedResponse(memoKey, payload, MEMORY_TTL_MS);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": EDGE_CACHE_CONTROL,
      },
    });
  }

  if (lookupFailed) {
    return NextResponse.json({ error: "Card lookup failed" }, { status: 503 });
  }

  return NextResponse.json({ error: "Card not found" }, { status: 404 });
}
