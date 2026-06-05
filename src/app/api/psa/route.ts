import { NextResponse } from "next/server";

import { fetchLivePsaData } from "@/lib/psa-population";

function emptyPsaPayload(error?: unknown) {
  const sourceStatus = error
    ? [
        {
          source: "PSA enrichment API",
          state: "failed" as const,
          confidence: "low" as const,
          confidenceScore: 0.15,
          fetchedAt: new Date().toISOString(),
          note: "Live PSA population and grading enrichment failed before source results could be returned.",
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
    const data = await fetchLivePsaData(
      setName,
      cardName,
      cardNumber,
      rawMarketPriceUsd ? Number(rawMarketPriceUsd) : undefined,
      setTotal ? Number(setTotal) : undefined,
    );

    if (!data) {
      return NextResponse.json(emptyPsaPayload());
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(emptyPsaPayload(error));
  }
}
