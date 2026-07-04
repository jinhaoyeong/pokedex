type ProviderResult = {
  provider?: string;
  sourceLabel?: string;
  ungradedUsd?: number | null;
  confidenceScore?: number;
  matchConfidence?: number;
  gradedPrices?: Array<{
    grade?: string;
    value?: number;
    lastSoldAt?: string | null;
    source?: string;
  }>;
  sales?: Array<{
    date?: string;
    price?: number;
    title?: string;
    source?: string;
  }>;
};

type PriceResponse = {
  primaryProvider?: string;
  marketPrice?: number | null;
  ungradedUsd?: number | null;
  psa10?: number | null;
  prices?: {
    market?: number | null;
    ungraded?: number | null;
    raw?: number | null;
    psa10?: number | null;
  };
  confidenceScore?: number;
  results?: ProviderResult[];
  error?: string;
};

type BenchmarkCard = {
  label: string;
  era: string;
  expectedProvider: string;
  params: Record<string, string>;
};

const BASE_URL = process.env.LIVE_ACCURACY_BASE_URL ?? "http://127.0.0.1:3000/api/price";
const RUN_ID = Date.now();

const BENCHMARKS: BenchmarkCard[] = [
  {
    label: "Charizard ex SV2a #201",
    era: "Modern Japanese / Pokemon Card 151",
    expectedProvider: "collectr-fallback",
    params: {
      slug: `live-accuracy-ja-charizard-sv2a-201-${RUN_ID}`,
      cardId: "sv2a-201",
      name: "Charizard ex",
      englishName: "Charizard ex",
      language: "ja",
      setCode: "SV2a",
      setName: "Pokemon Card 151",
      setEnglishName: "Pokemon Card 151",
      number: "201/165",
      rarity: "Special Illustration Rare",
    },
  },
  {
    label: "Charizard Base Set #4",
    era: "Vintage English / Base Set Unlimited",
    expectedProvider: "pricecharting-api",
    params: {
      slug: `live-accuracy-en-charizard-base-4-${RUN_ID}`,
      cardId: "base1-4",
      name: "Charizard",
      englishName: "Charizard",
      language: "en",
      setCode: "BASE1",
      setName: "Base Set",
      setEnglishName: "Base Set",
      number: "4/102",
      rarity: "Rare Holo",
    },
  },
  {
    label: "Umbreon VMAX Evolving Skies #215",
    era: "Modern English / High volatility",
    expectedProvider: "collectr-fallback or pricecharting-api",
    params: {
      slug: `live-accuracy-en-umbreon-vmax-swsh7-215-${RUN_ID}`,
      cardId: "swsh7-215",
      name: "Umbreon VMAX",
      englishName: "Umbreon VMAX",
      language: "en",
      setCode: "SWSH7",
      setName: "Evolving Skies",
      setEnglishName: "Evolving Skies",
      number: "215/203",
      rarity: "Rare Rainbow",
    },
  },
];

function buildUrl(card: BenchmarkCard) {
  const params = new URLSearchParams(card.params);

  if (process.env.INTERNAL_REFRESH_TOKEN) {
    params.set("refresh", "1");
  }

  params.set("accuracyRun", String(RUN_ID));
  return `${BASE_URL}?${params.toString()}`;
}

function money(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `$${value.toFixed(2)}`
    : "N/A";
}

function winner(payload: PriceResponse) {
  return (
    payload.primaryProvider ||
    payload.results?.find((result) => result.provider)?.provider ||
    "none"
  );
}

function rawMarket(payload: PriceResponse) {
  return (
    positive(payload.marketPrice) ??
    positive(payload.ungradedUsd) ??
    positive(payload.prices?.market) ??
    positive(payload.prices?.ungraded) ??
    positive(payload.prices?.raw) ??
    null
  );
}

function psa10(payload: PriceResponse) {
  return (
    positive(payload.psa10) ??
    positive(payload.prices?.psa10) ??
    positive(
      payload.results
        ?.flatMap((result) => result.gradedPrices ?? [])
        .find((price) => /^PSA\s*10$/i.test(price.grade ?? ""))?.value,
    ) ??
    null
  );
}

function positive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function latestSale(payload: PriceResponse) {
  const sales = payload.results
    ?.flatMap((result) => result.sales ?? [])
    .filter((sale) => sale.date && positive(sale.price))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));

  return sales?.[0] ?? null;
}

async function fetchBenchmark(card: BenchmarkCard) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  };

  if (process.env.INTERNAL_REFRESH_TOKEN) {
    headers["x-internal-token"] = process.env.INTERNAL_REFRESH_TOKEN;
  }

  const startedAt = performance.now();
  const response = await fetch(buildUrl(card), { headers });
  const elapsedMs = Math.round(performance.now() - startedAt);
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as PriceResponse) : {};

  return {
    status: response.status,
    elapsedMs,
    payload,
  };
}

async function main() {
  console.log("Live Accuracy Validator");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log(
    process.env.INTERNAL_REFRESH_TOKEN
      ? "Cache bypass: refresh=1 with x-internal-token"
      : "Cache bypass: unique slugs + no-store headers",
  );
  console.log("");

  for (const card of BENCHMARKS) {
    const { status, elapsedMs, payload } = await fetchBenchmark(card);
    const sale = latestSale(payload);

    console.log("=".repeat(72));
    console.log(`${card.label}`);
    console.log(`Era: ${card.era}`);
    console.log(`Expected Provider Bias: ${card.expectedProvider}`);
    console.log(`HTTP Status: ${status}`);
    console.log(`Response Time: ${elapsedMs}ms`);
    console.log(`Winning Provider: ${winner(payload)}`);
    console.log(`Raw Market Price: ${money(rawMarket(payload))}`);
    console.log(`PSA 10 Price: ${money(psa10(payload))}`);
    console.log(
      `Most Recent Sold Comp: ${
        sale ? `${sale.date} / ${money(sale.price)} / ${sale.source ?? "unknown"}` : "N/A"
      }`,
    );
    console.log(
      `Confidence Score: ${
        typeof payload.confidenceScore === "number"
          ? `${Math.round(payload.confidenceScore * 100)}%`
          : "N/A"
      }`,
    );

    if (payload.error) {
      console.log(`Error: ${payload.error}`);
    }

    console.log("");
  }
}

void main();

export {};
