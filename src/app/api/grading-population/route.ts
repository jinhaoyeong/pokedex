import { NextResponse } from "next/server";

import { fetchGradingPopulations } from "@/lib/grading/population-service";

export const maxDuration = 30;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get("cardName")?.trim() || params.get("name")?.trim();
  const collectorNumber =
    params.get("cardNumber")?.trim() || params.get("number")?.trim() || undefined;

  if (!name || !collectorNumber) {
    return NextResponse.json(
      { error: "cardName/name and cardNumber/number are required" },
      { status: 400 },
    );
  }

  try {
    const result = await fetchGradingPopulations(
      {
        name,
        englishName: params.get("englishName")?.trim() || undefined,
        setName: params.get("setName")?.trim() || undefined,
        setEnglishName: params.get("setEnglishName")?.trim() || undefined,
        setCode: params.get("setCode")?.trim() || undefined,
        collectorNumber,
        setPrintedTotal: params.get("setPrintedTotal")
          ? Number(params.get("setPrintedTotal"))
          : undefined,
        setTotal: params.get("setTotal") ? Number(params.get("setTotal")) : undefined,
        language: params.get("language")?.trim() || "en",
        rarity: params.get("rarity")?.trim() || undefined,
      },
      { services: params.get("services") ?? undefined },
    );

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        primaryPopulation: null,
        populations: {},
        providerResults: [],
        sourceStatus: [
          {
            source: "Grading population API",
            state: "failed",
            confidence: "low",
            confidenceScore: 0.1,
            fetchedAt: new Date().toISOString(),
            note: "Population orchestration failed before provider results were returned.",
            warning: error instanceof Error ? error.message : "Unknown error",
          },
        ],
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
