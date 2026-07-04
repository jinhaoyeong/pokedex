import { NextResponse } from "next/server";

import { fetchGradingMarketData } from "@/lib/grading-market";

/**
 * Live grading/population/sold-comp enrichment scrapes several public sources and can
 * take 20-40s. The default serverless timeout was cutting it off, which made graded
 * prices, the population grid, and sold comps come back empty in production. Allow a
 * longer budget (capped by the hosting plan) so the panels actually populate.
 */
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// A populated enrichment payload is stable enough to hold at the CDN edge for
// an hour (stale for a day). Empty/failed payloads stay no-store so a
// transient scrape failure is never frozen for the full revalidate window.
const EDGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

function emptyGradingMarketPayload(error?: unknown) {
  const sourceStatus = error
    ? [
        {
          source: "Grading market API",
          state: "failed" as const,
          confidence: "low" as const,
          confidenceScore: 0.15,
          fetchedAt: new Date().toISOString(),
          note: "Live grading, population, and sold-comp enrichment failed before source results could be returned.",
          warning: error instanceof Error ? error.message : "Unknown source error",
        },
      ]
    : [];

  return {
    psaPopulation: null,
    population: null,
    gradedPrices: [],
    priceHistory: [],
    recentSales: [],
    evidenceSummary: {
      accepted: 0,
      rejected: 0,
      thin: 0,
      fallback: 0,
      sourceStatus,
    },
    sourceStatus,
    marketEvidence: [],
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const setName = searchParams.get("setName");
  const cardName = searchParams.get("cardName");
  const cardNumber = searchParams.get("cardNumber");
  const rawMarketPriceUsd = searchParams.get("rawMarketPriceUsd");
  const setTotal = searchParams.get("setTotal");
  const rarity = searchParams.get("rarity");
  const setCode = searchParams.get("setCode");
  const language = searchParams.get("language");
  const englishCardName = searchParams.get("englishCardName");
  const skipSoldComps = searchParams.get("mode") === "core";

  if (!setName || !cardName || !cardNumber) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  try {
    const data = await fetchGradingMarketData(
      setName,
      cardName,
      cardNumber,
      rawMarketPriceUsd ? Number(rawMarketPriceUsd) : undefined,
      setTotal ? Number(setTotal) : undefined,
      rarity ?? undefined,
      {
        setCode: setCode ?? undefined,
        isJapanese: language === "ja",
        language: language ?? undefined,
        englishCardName: englishCardName ?? undefined,
        skipSoldComps,
      },
    );

    const hasSignal = Boolean(
      data &&
        (data.psaPopulation ||
          data.gradedPrices?.length ||
          data.priceHistory?.length ||
          data.recentSales?.length),
    );

    return NextResponse.json(data ?? emptyGradingMarketPayload(), {
      headers: {
        "Cache-Control": hasSignal ? EDGE_CACHE_CONTROL : "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(emptyGradingMarketPayload(error), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
