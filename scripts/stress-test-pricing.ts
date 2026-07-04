type PriceResponse = {
  primaryProvider?: string;
  provider?: string;
  marketPrice?: number | null;
  ungradedUsd?: number;
  confidenceScore?: number;
  results?: Array<{
    provider?: string;
    sourceLabel?: string;
    ungradedUsd?: number;
    confidenceScore?: number;
    matchConfidence?: number;
  }>;
  error?: string;
};

const BASE_URL = process.env.PRICE_STRESS_URL ?? "http://127.0.0.1:3000/api/price";
const CONCURRENCY = Number(process.env.PRICE_STRESS_CONCURRENCY ?? "20");
const MODE = process.env.PRICE_STRESS_MODE ?? "failover";
const RUN_ID = `${Date.now()}`;

function buildTargetUrl(phase: "integrity" | "blast") {
  const stressKind = MODE === "failover" ? "stress-failover" : "stress";
  const params = new URLSearchParams({
    slug: `ja--official-${stressKind}-${phase}-${RUN_ID}`,
    cardId: "sv2a-201",
    name: "Charizard ex",
    englishName: "Charizard ex",
    language: "ja",
    setCode: "SV2a",
    setName: "ポケモンカード151",
    setEnglishName: "Pokemon Card 151",
    number: "201/165",
    rarity: "Special Illustration Rare",
  });

  return `${BASE_URL}?${params.toString()}`;
}

function providerFromPayload(payload: PriceResponse | null) {
  return (
    payload?.primaryProvider ||
    payload?.provider ||
    payload?.results?.find((result) => result.provider)?.provider ||
    "none"
  );
}

function providerRoute(payload: PriceResponse | null) {
  const providers = payload?.results
    ?.map((result) => result.provider || result.sourceLabel)
    .filter(Boolean);

  return providers?.length ? providers.join(" -> ") : "none";
}

async function hitPriceEndpoint(url: string, index: number) {
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as PriceResponse) : null;

    return {
      ok: response.ok,
      index,
      status: response.status,
      elapsedMs,
      provider: providerFromPayload(payload),
      providerRoute: providerRoute(payload),
      marketPrice: payload?.marketPrice ?? payload?.ungradedUsd ?? null,
      confidenceScore: payload?.confidenceScore ?? null,
      error: payload?.error ?? (!response.ok ? text : ""),
    };
  } catch (error) {
    return {
      ok: false,
      index,
      status: 0,
      elapsedMs: Math.round(performance.now() - startedAt),
      provider: "none",
      providerRoute: "none",
      marketPrice: null,
      confidenceScore: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const integrityUrl = buildTargetUrl("integrity");
  const blastUrl = buildTargetUrl("blast");

  console.log("Pricing API stress test");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Card: Charizard ex SV2a #201 Japanese`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Mode: ${MODE}`);
  console.log("");

  console.log("Phase 1: integrity check");
  const integrity = await hitPriceEndpoint(integrityUrl, 1);
  console.log(
    `[single] status=${integrity.status} provider=${integrity.provider} route=${integrity.providerRoute} price=${integrity.marketPrice ?? "null"} confidence=${integrity.confidenceScore ?? "null"} time=${integrity.elapsedMs}ms error=${integrity.error || "none"}`,
  );
  console.log("");

  console.log(`Phase 2: concurrency blast (${CONCURRENCY} simultaneous requests)`);
  const settled = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, (_, index) => hitPriceEndpoint(blastUrl, index + 1)),
  );

  let fulfilled = 0;
  let rejected = 0;
  let httpErrors = 0;
  const providerCounts = new Map<string, number>();
  const times: number[] = [];

  for (const entry of settled) {
    if (entry.status === "rejected") {
      rejected += 1;
      console.log(`[blast ??] rejected error=${entry.reason}`);
      continue;
    }

    fulfilled += 1;
    const result = entry.value;
    times.push(result.elapsedMs);
    providerCounts.set(result.provider, (providerCounts.get(result.provider) ?? 0) + 1);

    if (!result.ok || result.status >= 500) {
      httpErrors += 1;
    }

    console.log(
      `[blast ${String(result.index).padStart(2, "0")}] status=${result.status} provider=${result.provider} route=${result.providerRoute} price=${result.marketPrice ?? "null"} confidence=${result.confidenceScore ?? "null"} time=${result.elapsedMs}ms error=${result.error || "none"}`,
    );
  }

  const min = times.length ? Math.min(...times) : 0;
  const max = times.length ? Math.max(...times) : 0;
  const avg = times.length
    ? Math.round(times.reduce((total, value) => total + value, 0) / times.length)
    : 0;

  console.log("");
  console.log("Summary");
  console.log(`fulfilled=${fulfilled} rejected=${rejected} httpErrors=${httpErrors}`);
  console.log(`latencyMs min=${min} avg=${avg} max=${max}`);
  console.log(
    `providers=${[...providerCounts.entries()]
      .map(([provider, count]) => `${provider}:${count}`)
      .join(", ") || "none"}`,
  );
}

void main();

export {};
