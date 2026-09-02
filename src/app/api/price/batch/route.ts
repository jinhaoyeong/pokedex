import { NextResponse } from "next/server";

import { lookupListPricesBatch } from "@/lib/price/list-price-batch.server";
import { PRICE_SORT_BATCH_MAX_CARDS } from "@/lib/price/list-price-batch";

export const maxDuration = 10;
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const cards = Array.isArray((body as { cards?: unknown }).cards)
    ? ((body as { cards: unknown[] }).cards as Array<Record<string, string | undefined | null>>)
    : null;

  if (!cards) {
    return NextResponse.json({ error: "cards array is required" }, { status: 400 });
  }

  const prices = await lookupListPricesBatch(cards.slice(0, PRICE_SORT_BATCH_MAX_CARDS));

  return NextResponse.json(
    { prices },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
