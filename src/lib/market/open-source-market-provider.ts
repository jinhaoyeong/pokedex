import "server-only";

import {
  buildMarketCardIdentity,
  type MarketCardIdentity,
  type MarketCardIdentityInput,
} from "@/lib/market/card-identity";
import {
  readMarketFileCache,
  writeMarketFileCache,
} from "@/lib/market/file-cache.server";
import { fetchMarketJson } from "@/lib/market/http-client";
import { isFirstEditionFinish, selectFinishMarketUsd } from "@/lib/card-finish";
import { isPokemonTcgPocketPrint } from "@/lib/pokemon-tcg/tcg-pocket";
import type { GradedPrice } from "@/types/pokemon";

type OpenSourceMarketResult = {
  provider: "pokemontcg-open" | "tcgdex-open";
  sourceLabel: string;
  sourceUrl: string;
  ungradedUsd: number;
  confidenceScore: number;
  matchConfidence: number;
  gradedPrices: GradedPrice[];
  fetchedAt: string;
  status?: "priced" | "catalog_found_no_price";
  warning?: string;
};

type PokemonTcgPriceBucket = { market?: number | null; mid?: number | null; low?: number | null };
type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: { name?: string; id?: string; printedTotal?: number; total?: number };
  tcgplayer?: { prices?: Record<string, PokemonTcgPriceBucket | null> | null } | null;
  cardmarket?: {
    prices?: { trendPrice?: number | null; averageSellPrice?: number | null; avg7?: number | null } | null;
  } | null;
};
type PokemonTcgResponse = { data?: PokemonTcgCard[] | null };

type TcgdexCard = {
  id?: string;
  localId?: string;
  name?: string;
  set?: { id?: string; name?: string } | null;
  image?: string;
  pricing?: {
    cardmarket?: {
      trend?: number | null;
      avg?: number | null;
      avg7?: number | null;
      avg30?: number | null;
    } | null;
    tcgplayer?: {
      market?: number | null;
      mid?: number | null;
      holofoil?: { market?: number | null; mid?: number | null } | null;
      "reverse-holofoil"?: { market?: number | null; mid?: number | null } | null;
    } | null;
  } | null;
};

const POKEMONTCG_API_BASE_URL = "https://api.pokemontcg.io/v2";
const TCGDEX_API_BASE_URL = "https://api.tcgdex.net/v2";
const EUR_TO_USD = 1.08;
const CACHE_TTL_MS = Number(
  process.env.OPEN_SOURCE_MARKET_CACHE_TTL_MS ?? String(24 * 60 * 60 * 1000),
);

function nowIso() {
  return new Date().toISOString();
}

function normalize(value?: string) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function uniq(values: Array<string | undefined>) {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = normalize(value);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function positiveUsd(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
}

function pokemonTcgBestUsd(card: PokemonTcgCard | undefined, finish?: MarketCardIdentity["finish"]) {
  const buckets = card?.tcgplayer?.prices ?? {};
  const finishUsd = selectFinishMarketUsd(buckets, finish);
  if (finishUsd > 0) {
    return positiveUsd(finishUsd);
  }

  if (isFirstEditionFinish(finish)) {
    return 0;
  }

  const cm = card?.cardmarket?.prices;
  const cardmarketEur = cm?.trendPrice ?? cm?.avg7 ?? cm?.averageSellPrice ?? 0;
  return positiveUsd(cardmarketEur ? cardmarketEur * EUR_TO_USD : 0);
}

function tcgdexLanguage(language: string) {
  const lower = language.toLowerCase();
  if (lower === "zh-cn" || lower === "zh-tw" || lower.startsWith("zh")) {
    return "zh-tw";
  }
  return lower || "en";
}

function tcgdexBestUsd(card: TcgdexCard | null | undefined, finish?: MarketCardIdentity["finish"]) {
  if (isFirstEditionFinish(finish)) {
    return 0;
  }

  const pricing = card?.pricing;
  const tcgplayerUsd =
    pricing?.tcgplayer?.market ??
    pricing?.tcgplayer?.holofoil?.market ??
    pricing?.tcgplayer?.["reverse-holofoil"]?.market ??
    pricing?.tcgplayer?.mid ??
    pricing?.tcgplayer?.holofoil?.mid ??
    0;

  if (tcgplayerUsd && tcgplayerUsd > 0) {
    return positiveUsd(tcgplayerUsd);
  }

  const cardmarketEur =
    pricing?.cardmarket?.trend ??
    pricing?.cardmarket?.avg7 ??
    pricing?.cardmarket?.avg ??
    pricing?.cardmarket?.avg30 ??
    0;
  return positiveUsd(cardmarketEur ? cardmarketEur * EUR_TO_USD : 0);
}

function gradePrice(input: {
  sourceLabel: string;
  sourceUrl: string;
  value: number;
  confidenceScore: number;
}): GradedPrice[] {
  return [
    {
      grade: "Ungraded",
      value: input.value,
      populationCount: 0,
      source: input.sourceLabel,
      saleCount: 0,
      lastSoldAt: null,
      service: "RAW",
      confidence: input.confidenceScore >= 0.5 ? "medium" : "low",
      confidenceScore: input.confidenceScore,
      evidenceType: "catalog",
      sourceUrl: input.sourceUrl,
    },
  ];
}

function pokemonTcgSetAliases(identity: MarketCardIdentity) {
  const english = identity.englishSetName || identity.nativeSetName;
  return uniq([
    english,
    identity.nativeSetName,
    identity.setCode,
    normalize(english) === "base set" ? "Base" : undefined,
    /\sset$/i.test(english) ? english.replace(/\sset$/i, "") : undefined,
  ]);
}

function cardMatches(identity: MarketCardIdentity, card: PokemonTcgCard, setAlias?: string) {
  const number = normalize(card.number);
  const setName = normalize(card.set?.name);
  const name = normalize(card.name);
  const setAliases = setAlias ? [setAlias] : pokemonTcgSetAliases(identity);

  return (
    number === normalize(identity.numberBase) &&
    name === normalize(identity.englishName) &&
    setAliases.some((alias) => setName === normalize(alias))
  );
}

async function fetchPokemonTcg(identity: MarketCardIdentity, signal?: AbortSignal) {
  if (identity.language !== "en") {
    return null;
  }

  const apiKey = process.env.POKEMONTCG_API_KEY?.trim();
  let card: PokemonTcgCard | undefined;
  let url = "";

  for (const setAlias of pokemonTcgSetAliases(identity)) {
    const q = [
      `name:"${identity.englishName}"`,
      `number:${identity.numberBase}`,
      `set.name:"${setAlias}"`,
    ].join(" ");
    url = `${POKEMONTCG_API_BASE_URL}/cards?q=${encodeURIComponent(q)}&pageSize=10`;
    const response = await fetchMarketJson<PokemonTcgResponse>(url, {
      signal,
      timeoutMs: 8_000,
      headers: apiKey ? { "X-Api-Key": apiKey } : undefined,
    });
    card = response?.data?.find((candidate) => cardMatches(identity, candidate, setAlias));

    if (card) {
      break;
    }
  }

  const ungradedUsd = pokemonTcgBestUsd(card, identity.finish);

  if (!card || !(ungradedUsd > 0)) {
    return null;
  }

  const sourceUrl = card.id ? `${POKEMONTCG_API_BASE_URL}/cards/${card.id}` : url;
  return {
    provider: "pokemontcg-open" as const,
    sourceLabel: "PokemonTCG API catalog",
    sourceUrl,
    ungradedUsd,
    confidenceScore: 0.6,
    matchConfidence: 1,
    gradedPrices: gradePrice({
      sourceLabel: "PokemonTCG API catalog",
      sourceUrl,
      value: ungradedUsd,
      confidenceScore: 0.6,
    }),
    fetchedAt: nowIso(),
  };
}

async function fetchTcgdex(identity: MarketCardIdentity, signal?: AbortSignal) {
  const id = identity.setCode && identity.numberBase
    ? `${identity.setCode.toLowerCase()}-${identity.numberBase.toLowerCase()}`
    : "";

  if (!id) {
    return null;
  }

  if (isPokemonTcgPocketPrint({ id, setId: identity.setCode, setCode: identity.setCode })) {
    return null;
  }

  const lang = tcgdexLanguage(identity.language);
  const url = `${TCGDEX_API_BASE_URL}/${lang}/cards/${encodeURIComponent(id)}`;
  const card = await fetchMarketJson<TcgdexCard>(url, { signal, timeoutMs: 8_000 });

  if (!card?.id) {
    return null;
  }

  const ungradedUsd = tcgdexBestUsd(card, identity.finish);
  const sourceLabel = identity.language === "en" ? "TCGdex catalog" : "TCGdex localized catalog";

  if (!(ungradedUsd > 0)) {
    return {
      provider: "tcgdex-open" as const,
      sourceLabel,
      sourceUrl: url,
      ungradedUsd: 0,
      confidenceScore: 0.22,
      matchConfidence: 1,
      gradedPrices: [],
      fetchedAt: nowIso(),
      status: "catalog_found_no_price" as const,
      warning: "TCGdex found the localized card identity, but its public pricing fields are empty.",
    };
  }

  return {
    provider: "tcgdex-open" as const,
    sourceLabel,
    sourceUrl: url,
    ungradedUsd,
    confidenceScore: identity.language === "en" ? 0.48 : 0.34,
    matchConfidence: 1,
    gradedPrices: gradePrice({
      sourceLabel: identity.language === "en" ? "TCGdex catalog" : "TCGdex localized catalog",
      sourceUrl: url,
      value: ungradedUsd,
      confidenceScore: identity.language === "en" ? 0.48 : 0.34,
    }),
    fetchedAt: nowIso(),
    status: "priced" as const,
  };
}

export async function fetchOpenSourceMarketFallback(
  input: MarketCardIdentityInput,
  signal?: AbortSignal,
): Promise<OpenSourceMarketResult | null> {
  const identity = buildMarketCardIdentity(input);
  const cacheKey = identity.key;
  const cached = await readMarketFileCache<OpenSourceMarketResult>(
    "open-source-market",
    cacheKey,
    CACHE_TTL_MS,
  );

  if (cached) {
    return cached;
  }

  const result = (await fetchPokemonTcg(identity, signal)) ?? (await fetchTcgdex(identity, signal));

  if (result) {
    await writeMarketFileCache("open-source-market", cacheKey, result);
  }

  return result;
}

export async function readCachedOpenSourceMarketFallback(
  input: MarketCardIdentityInput,
): Promise<OpenSourceMarketResult | null> {
  const identity = buildMarketCardIdentity(input);
  return readMarketFileCache<OpenSourceMarketResult>(
    "open-source-market",
    identity.key,
    CACHE_TTL_MS,
  );
}
