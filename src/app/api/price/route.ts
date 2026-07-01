import { NextResponse } from "next/server";

import { resolvePrice } from "@/lib/price/resolve.server";
import type { PriceQuery } from "@/lib/price/types";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Block-resistant price lookup. Reads the local price cache first and, on a miss,
 * queries only the NON-BLOCKING API providers (never a scrape). Safe to call from
 * the list/detail UI without ever triggering an IP block.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug")?.trim();
  const name = params.get("name")?.trim();

  if (!slug || !name) {
    return NextResponse.json({ error: "slug and name are required" }, { status: 400 });
  }

  const query: PriceQuery = {
    slug,
    name,
    language: params.get("language")?.trim() || "en",
    cardId: params.get("cardId")?.trim() || undefined,
    setCode: params.get("setCode")?.trim() || undefined,
    setName: params.get("setName")?.trim() || undefined,
    setEnglishName: params.get("setEnglishName")?.trim() || undefined,
    collectorNumber: params.get("number")?.trim() || undefined,
    englishName: params.get("englishName")?.trim() || undefined,
    rarity: params.get("rarity")?.trim() || undefined,
  };

  // The background warmer forces a fresh, scrape-allowed resolve via an internal
  // token. Public callers always get the fast cache-first, non-blocking path.
  const internalToken = process.env.INTERNAL_REFRESH_TOKEN;
  const isWarm =
    params.get("refresh") === "1" &&
    Boolean(internalToken) &&
    request.headers.get("x-internal-token") === internalToken;

  try {
    const resolved = await resolvePrice(
      query,
      isWarm ? { refresh: true, ttlMs: 0, allowScrape: true } : {},
    );
    return NextResponse.json(resolved, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("price lookup failed", { slug, error });
    return NextResponse.json(
      { slug, ungradedUsd: 0, confidenceScore: 0, primaryProvider: "", results: [] },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
