import { after, NextResponse } from "next/server";

import { fetchGradingPopulations } from "@/lib/grading/population-service";
import { buildPopulationKey, writeStoredPopulation } from "@/lib/psa-population-store.server";
import { readCachedResponse, writeCachedResponse } from "@/lib/server-response-cache";

export const maxDuration = 30;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Population counts move slowly; hold successful reports at the CDN edge for
// an hour (stale for a day) and in process memory for repeat lookups.
const EDGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const MEMORY_TTL_MS = 30 * 60_000;

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

  const memoKey = `grading-population:${new URLSearchParams(
    [...params.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ).toString()}`;
  const memoized = readCachedResponse<Awaited<ReturnType<typeof fetchGradingPopulations>>>(memoKey);

  if (memoized) {
    return NextResponse.json(memoized, {
      headers: { "Cache-Control": EDGE_CACHE_CONTROL, "X-Memory-Cache": "hit" },
    });
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

    const hasSignal = Boolean(
      result.primaryPopulation || Object.keys(result.populations ?? {}).length,
    );

    if (hasSignal) {
      writeCachedResponse(memoKey, result, MEMORY_TTL_MS);
    }

    // Hand the census to the durable store on the key card detail reads back.
    // That path gets 250ms — nowhere near enough to fetch a census, but ample
    // to read one — so persisting here is what turns this route from a repair
    // every viewer pays for into a first paint the next viewer never notices.
    //
    // Through after(), not a floating promise. A `void write(...)` here does
    // not survive the response: the platform is free to freeze the function
    // the moment it returns, and locally the row simply never appeared. after()
    // is the runtime's own contract for work that outlives the response, and it
    // keeps the census off the response's critical path.
    const census = result.primaryPopulation;
    if (census && (census.grades.length > 0 || typeof census.totalCertified === "number")) {
      // buildFastGuideMarketResult keys on the English name when it has one,
      // so the same preference has to be applied here or the row lands under
      // a key nothing ever looks up.
      const identity = {
        setName: params.get("setName")?.trim() || "",
        cardName: params.get("englishName")?.trim() || name,
        cardNumber: collectorNumber,
        setCode: params.get("setCode")?.trim() || undefined,
        language: params.get("language")?.trim() || "en",
      };
      const storeKey = buildPopulationKey({
        ...identity,
        officialCardId: params.get("officialCardId")?.trim() || undefined,
        priceChartingProductId: params.get("priceChartingProductId")?.trim() || undefined,
        identityVersion: params.get("identityVersion")
          ? Number(params.get("identityVersion"))
          : undefined,
        finish: params.get("finish")?.trim() || undefined,
      });

      after(() =>
        // Census only. This route resolves no prices, and an empty price list
        // is read as "nothing to add" rather than as zeroes to merge in.
        writeStoredPopulation(storeKey, identity, {
          snapshot: census,
          gradedPrices: [],
          sourceKind: "item",
        }),
      );
    }

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": hasSignal ? EDGE_CACHE_CONTROL : "no-store",
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
