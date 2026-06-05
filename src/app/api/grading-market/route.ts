import { NextResponse } from "next/server";

import { fetchGradingMarketData } from "@/lib/grading-market";

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
    );

    return NextResponse.json(
      data ?? emptyGradingMarketPayload(),
    );
  } catch (error) {
    return NextResponse.json(emptyGradingMarketPayload(error));
  }
}
