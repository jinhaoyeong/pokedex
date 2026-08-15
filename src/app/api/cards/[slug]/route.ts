import { NextResponse } from "next/server";

import { getCardCatalogCached } from "@/lib/card-catalog";
import { lookupBundledCardBySlug } from "@/lib/bundled-cards";
import { getCardBySlug } from "@/lib/cards";
import { sanitizePartialPreviewMarketCard } from "@/lib/grading-market-lookup";
import { readCachedResponse, writeCachedResponse } from "@/lib/server-response-cache";
import type { TcgCard } from "@/types/pokemon";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Successful card payloads are browser+edge cacheable. Short max-age lets the
// detail page reuse a warm catalog identity on back/forward without changing
// live market enrichment (/api/price + /api/grading-market stay separate).
// Failed/degraded lookups stay no-store so recovery is visible immediately.
const EDGE_CACHE_CONTROL =
  "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400";
const MEMORY_TTL_MS = 5 * 60_000;

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  // v3 prevents a previously cached, incomplete Japanese browse/index card
  // from masking the strict official-detail identity handoff below.
  const memoKey = `card:v4:${slug}`;
  const memoized = readCachedResponse<Record<string, unknown>>(memoKey);

  if (memoized) {
    const memoizedCard =
      memoized.card && typeof memoized.card === "object"
        ? sanitizePartialPreviewMarketCard(memoized.card as TcgCard)
        : undefined;

    return NextResponse.json({ ...memoized, ...(memoizedCard ? { card: memoizedCard } : {}) }, {
      headers: { "Cache-Control": EDGE_CACHE_CONTROL, "X-Memory-Cache": "hit" },
    });
  }

  let lookup: Awaited<ReturnType<typeof getCardCatalogCached>>;

  try {
    // Identity only. Magery sold-comp scrapes used to block this route for
    // 10–20s; /api/price and /api/grading-market refine market data after paint.
    lookup = await getCardCatalogCached(slug, false);
  } catch (error) {
    console.error(`Card API lookup failed for "${slug}"`, error);
    const localCard = lookupBundledCardBySlug(slug) ?? getCardBySlug(slug);

    if (localCard) {
      const sanitizedCard = sanitizePartialPreviewMarketCard(localCard);
      return NextResponse.json(
        { card: sanitizedCard, source: "local", degraded: true },
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

  if (lookupFailed && lookup.identityRetryable) {
    return NextResponse.json(
      {
        error: "Japanese card identity is temporarily unavailable",
        code: "JAPANESE_OFFICIAL_IDENTITY_RETRYABLE",
        retryable: true,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (card) {
    const payload = {
      card: sanitizePartialPreviewMarketCard(card),
      source: source ?? (getCardBySlug(slug) ? "local" : "live"),
    };
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
