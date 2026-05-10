import type { TcgCard, TcgSet } from "@/types/pokemon";

const API_BASE_URL = "https://api.pokemontcg.io/v2";

interface PokemonTcgSetApiResponse {
  data: Array<{
    id: string;
    name: string;
    series: string;
    releaseDate: string;
  }>;
}

interface PokemonTcgCardApiPriceBucket {
  low?: number;
  market?: number;
  mid?: number;
}

interface PokemonTcgCardApiResponse {
  data: Array<{
    id: string;
    name: string;
    supertype?: string;
    hp?: string;
    types?: string[];
    number: string;
    rarity?: string;
    artist?: string;
    images?: {
      small?: string;
      large?: string;
    };
    set: {
      id: string;
      name: string;
      series: string;
      releaseDate: string;
    };
    tcgplayer?: {
      updatedAt?: string;
      prices?: Record<string, PokemonTcgCardApiPriceBucket>;
    };
    cardmarket?: {
      updatedAt?: string;
      prices?: {
        avg1?: number;
        avg7?: number;
        avg30?: number;
        trendPrice?: number;
      };
    };
  }>;
}

function normalizeSetCode(setId: string) {
  return setId.toUpperCase();
}

const PREFERRED_PRICE_BUCKET_ORDER = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "1stEditionHolofoil",
  "1stEditionNormal",
];

function getPreferredPriceBuckets(card: PokemonTcgCardApiResponse["data"][number]) {
  const priceMap = card.tcgplayer?.prices ?? {};
  const preferredBuckets = PREFERRED_PRICE_BUCKET_ORDER
    .map((bucketKey) => priceMap[bucketKey])
    .filter((bucket): bucket is PokemonTcgCardApiPriceBucket => Boolean(bucket));
  const remainingBuckets = Object.entries(priceMap)
    .filter(([bucketKey]) => !PREFERRED_PRICE_BUCKET_ORDER.includes(bucketKey))
    .map(([, bucket]) => bucket);

  return [...preferredBuckets, ...remainingBuckets];
}

function getUsdMarketPrice(card: PokemonTcgCardApiResponse["data"][number]) {
  const priceBuckets = getPreferredPriceBuckets(card);

  for (const bucket of priceBuckets) {
    if (typeof bucket.market === "number") {
      return bucket.market;
    }
  }

  for (const bucket of priceBuckets) {
    if (typeof bucket.mid === "number") {
      return bucket.mid;
    }
  }

  for (const bucket of priceBuckets) {
    if (typeof bucket.low === "number") {
      return bucket.low;
    }
  }

  return 0;
}

function buildPriceHistory(card: PokemonTcgCardApiResponse["data"][number]) {
  const currentValue = getUsdMarketPrice(card);
  const cardmarket = card.cardmarket?.prices;

  return [
    { date: "30d", value: cardmarket?.avg30 ?? currentValue },
    { date: "7d", value: cardmarket?.avg7 ?? currentValue },
    { date: "1d", value: cardmarket?.avg1 ?? currentValue },
    { date: "trend", value: cardmarket?.trendPrice ?? currentValue },
    { date: "now", value: currentValue },
  ];
}

function normalizeCard(
  card: PokemonTcgCardApiResponse["data"][number],
): TcgCard {
  const marketPriceUsd = getUsdMarketPrice(card);
  const fetchedAt =
    card.tcgplayer?.updatedAt ?? card.cardmarket?.updatedAt ?? new Date().toISOString();

  return {
    id: card.id,
    slug: card.id,
    name: card.name,
    collectorNumber: card.number,
    rarity: card.rarity ?? "Unknown",
    supertype: card.supertype ?? "Pokemon",
    hp: card.hp ?? "-",
    types: card.types ?? [],
    setId: card.set.id,
    setCode: normalizeSetCode(card.set.id),
    setName: card.set.name,
    image: card.images?.large ?? card.images?.small ?? "/icon.svg",
    artist: card.artist ?? "Unknown",
    marketPriceUsd,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "PSA population report",
      fetchedAt: null,
      note: "PSA pop counts are not wired yet. The model reserves official PSA-by-grade data instead of a generic population placeholder.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: buildPriceHistory(card),
    gradedPrices: [
      {
        grade: "Ungraded",
        value: marketPriceUsd,
        populationCount: 0,
      },
    ],
    recentSales: [],
    sources: [
      {
        source: "PokemonTCG public catalog",
        status: "verified",
        fetchedAt,
        confidence: 0.82,
        note: "Live no-key catalog and marketplace snapshot. Sold comps and official PSA pop counts are not wired yet.",
      },
    ],
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    throw new Error(`Pokemon TCG API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchLiveSets(): Promise<TcgSet[]> {
  const payload = await fetchJson<PokemonTcgSetApiResponse>(`${API_BASE_URL}/sets`);

  return payload.data
    .map((set) => ({
      id: set.id,
      name: set.name,
      code: normalizeSetCode(set.id),
      series: set.series,
      releaseDate: set.releaseDate,
    }))
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}

export async function searchLiveCards(query: string, setFilter?: string) {
  const filters: string[] = [];
  const cleanQuery = query.trim();

  if (setFilter) {
    filters.push(`set.id:${setFilter.toLowerCase()}`);
  }

  if (cleanQuery) {
    const escapedQuery = cleanQuery.replace(/"/g, '\\"');
    filters.push(
      `(name:"*${escapedQuery}*" OR number:"${escapedQuery}" OR set.name:"*${escapedQuery}*" OR artist:"*${escapedQuery}*")`,
    );
  }

  const searchParams = new URLSearchParams({
    pageSize: "24",
    orderBy: "-set.releaseDate,number",
  });

  if (filters.length) {
    searchParams.set("q", filters.join(" AND "));
  }

  const url = `${API_BASE_URL}/cards?${searchParams.toString()}`;
  const payload = await fetchJson<PokemonTcgCardApiResponse>(url);

  return payload.data.map((card) => ({
    card: normalizeCard(card),
    score: 100,
    matchReason: cleanQuery ? "Live catalog match" : "Latest cards",
  }));
}

export async function fetchLiveCardById(id: string): Promise<TcgCard | null> {
  const payload = await fetchJson<PokemonTcgCardApiResponse>(
    `${API_BASE_URL}/cards?q=id:${encodeURIComponent(id)}&pageSize=1`,
  );

  const card = payload.data[0];
  return card ? normalizeCard(card) : null;
}
