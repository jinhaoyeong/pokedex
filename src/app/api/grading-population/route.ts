import { NextResponse } from "next/server";

import { fetchGradingPopulations } from "@/lib/grading/population-service";
import {
  buildPopulationKey,
  readStoredPopulation,
  writeStoredPopulation,
  type PopulationIdentity,
} from "@/lib/psa-population-store.server";
import { readCachedResponse, writeCachedResponse } from "@/lib/server-response-cache";
import type { PsaPopulationSnapshot } from "@/types/pokemon";

export const maxDuration = 30;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Population counts move slowly; hold successful reports at the CDN edge for
// an hour (stale for a day) and in process memory for repeat lookups.
const EDGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const MEMORY_TTL_MS = 30 * 60_000;

function censusHasSignal(snapshot: PsaPopulationSnapshot | null | undefined) {
  return Boolean(
    snapshot && (snapshot.grades.length > 0 || typeof snapshot.totalCertified === "number"),
  );
}

/** A stored census, shaped like a provider result so the client merges it the same way. */
function storedCensusResult(snapshot: PsaPopulationSnapshot) {
  const service = snapshot.service ?? "PSA";
  return {
    primaryPopulation: snapshot,
    populations: { [service]: snapshot },
    providerResults: [],
    sourceStatus: [
      {
        source: snapshot.source || "Stored population census",
        state: "ready" as const,
        confidence: snapshot.confidence ?? ("medium" as const),
        confidenceScore: snapshot.confidenceScore ?? 0.5,
        fetchedAt: snapshot.fetchedAt,
        note: "Census served from the stored population snapshot.",
        sourceUrl: snapshot.sourceUrl,
        sampleCount: snapshot.grades.length,
      },
    ],
  };
}

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

  // One identity, and the key is derived from it.
  //
  // Two things have to hold or the census is filed where nothing looks for it.
  // buildFastGuideMarketResult keys on the English name when a card has one,
  // so that preference is applied here too. And writeStoredPopulation builds
  // its second, set-code-free key from whatever identity it is handed — pass a
  // slimmed copy beside a fuller key and the portable row is filed without the
  // finish, which is exactly one field out of every reader's reach.
  const storeIdentity: PopulationIdentity = {
    setName: params.get("setName")?.trim() || "",
    cardName: params.get("englishName")?.trim() || name,
    cardNumber: collectorNumber,
    setCode: params.get("setCode")?.trim() || undefined,
    language: params.get("language")?.trim() || "en",
    officialCardId: params.get("officialCardId")?.trim() || undefined,
    priceChartingProductId: params.get("priceChartingProductId")?.trim() || undefined,
    identityVersion: params.get("identityVersion")
      ? Number(params.get("identityVersion"))
      : undefined,
    finish: params.get("finish")?.trim() || undefined,
  };
  const storeKey = buildPopulationKey(storeIdentity);

  // The durable store, before any provider is asked.
  //
  // This is what makes the panel work in production at all. The census comes
  // from a free public page, and that page answers a laptop but not a Vercel
  // function — from there it returns a body the parser reads as "no match", so
  // every provider path ends empty however long it is given. What production
  // CAN do is read a census someone else already resolved. So the store is not
  // a cache in front of the providers here; it is the source that works, and
  // the providers are the fallback that fills it.
  const stored = await readStoredPopulation(storeKey);
  if (stored && censusHasSignal(stored.snapshot)) {
    return NextResponse.json(storedCensusResult(stored.snapshot), {
      headers: { "Cache-Control": EDGE_CACHE_CONTROL, "X-Population-Source": "store" },
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

    // Hand the census to the durable store on the keys card detail reads back,
    // so a lookup made anywhere serves every later viewer everywhere — which
    // is the only way the panel ever fills on a host that cannot fetch one.
    const census = result.primaryPopulation;
    if (census && censusHasSignal(census)) {
      // Awaited, not deferred. The response is already seconds old by the time
      // a provider has answered, so the ~90ms this costs is noise — and the
      // whole point of the route is that the census outlives this request.
      // Census only: this route resolves no prices, and an empty price list is
      // read as "nothing to add" rather than as zeroes to merge in.
      const wrote = await writeStoredPopulation(storeKey, storeIdentity, {
        snapshot: census,
        gradedPrices: [],
        sourceKind: "item",
      });

      // Loud on failure. A census that resolves and then vanishes is the exact
      // shape of bug that leaves the panel empty with nothing to look at.
      if (!wrote) {
        console.warn(
          "[grading-population] census resolved but could not be stored:",
          storeKey,
        );
      }
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
