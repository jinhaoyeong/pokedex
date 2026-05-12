import { NextResponse } from "next/server";

import { fetchLivePsaData } from "@/lib/psa-population";

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
      return NextResponse.json({
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
          sourceStatus: [],
        },
        sourceStatus: [],
        marketEvidence: [],
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
