import { NextResponse } from "next/server";

import { getCardBySlug } from "@/lib/cards";
import { fetchLiveCardBySlug } from "@/lib/pokemon-tcg-api";

export const maxDuration = 20;

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const localCard = getCardBySlug(slug);

  if (localCard) {
    return NextResponse.json(
      { card: localCard, source: "local" },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  }

  try {
    const card = await fetchLiveCardBySlug(slug, {
      includePublicPriceFallback: false,
    });

    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    return NextResponse.json(
      { card, source: "live" },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.error(`Live card API lookup failed for "${slug}"`, error);
    return NextResponse.json({ error: "Card lookup failed" }, { status: 503 });
  }
}
