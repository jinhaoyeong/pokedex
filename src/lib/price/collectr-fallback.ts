import "server-only";

import { buildMarketCardIdentity } from "@/lib/market/card-identity";
import { fetchWithEvasion } from "@/lib/network-utils";

import { nowIso } from "./providers/shared";
import type { PriceQuery, ProviderPriceResult } from "./types";

type CollectrCatalogItem = {
  product_id?: string | number;
  catalog_category_name?: string;
  catalog_group?: string;
  product_name?: string;
  card_number?: string;
  rarity?: string;
  is_card?: boolean;
  latest_price?: string | number;
  market_price?: string | number;
  older_market_price?: string | number;
  web_slug_group?: string;
};

type CollectrCatalogResponse = {
  data?: CollectrCatalogItem[];
};

const COLLECTR_API_BASE_URL =
  process.env.COLLECTR_API_BASE_URL?.trim()?.replace(/\/$/, "") ||
  "https://api-v2.getcollectr.com";
const COLLECTR_ANON_USERNAME =
  process.env.COLLECTR_ANON_USERNAME?.trim() || "00000000-0000-0000-0000-000000000000";
const COLLECTR_TIMEOUT_MS = Number(process.env.COLLECTR_TIMEOUT_MS ?? "4500");

function clean(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function normalize(value?: string | null) {
  return clean(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/pokemon/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberBase(value?: string | null) {
  return clean(value).split("/")[0]?.replace(/^0+(?=\d)/, "") ?? "";
}

function price(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value * 100) / 100;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  }

  return 0;
}

function queryVariants(query: PriceQuery) {
  const identity = buildMarketCardIdentity({
    language: query.language,
    name: query.name,
    englishName: query.englishName,
    setName: query.setName,
    setEnglishName: query.setEnglishName,
    setCode: query.setCode,
    collectorNumber: query.collectorNumber,
    rarity: query.rarity,
  });
  const name = identity.englishName || query.englishName || query.name;
  const setCode = identity.setCode === "SV2A" ? "SV2a" : identity.setCode;
  const number = identity.numberBase || numberBase(query.collectorNumber);

  return [
    [name, setCode, number].filter(Boolean).join(" "),
    [setCode, number].filter(Boolean).join(" "),
    [name, number, query.setEnglishName || query.setName].filter(Boolean).join(" "),
    ...identity.priceChartingQueries.slice(0, 4).map((item) => item.replace(/\bJapanese\b/gi, "")),
  ].filter(Boolean);
}

function catalogUrl(searchString: string) {
  const params = new URLSearchParams({
    username: COLLECTR_ANON_USERNAME,
    searchString,
    offset: "0",
    limit: "12",
    unstackedView: "",
  });

  return `${COLLECTR_API_BASE_URL}/catalog?${params.toString()}`;
}

async function fetchCatalog(searchString: string, signal?: AbortSignal) {
  const response = await fetchWithEvasion(catalogUrl(searchString), {
    language: "en",
    signal,
    timeoutMs: COLLECTR_TIMEOUT_MS,
    allowTrustedProxy: true,
    headers: {
      Origin: "https://app.getcollectr.com",
      Referer: "https://app.getcollectr.com/",
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as CollectrCatalogResponse | null;
}

function scoreItem(item: CollectrCatalogItem, query: PriceQuery) {
  if (item.is_card === false || !/pokemon/i.test(item.catalog_category_name ?? "")) {
    return 0;
  }

  const targetNumber = numberBase(query.collectorNumber);
  const itemNumber = numberBase(item.card_number);
  const nameNeedle = normalize(query.englishName || query.name);
  const itemName = normalize(item.product_name);
  const setNeedles = [query.setEnglishName, query.setName, query.setCode, "151"]
    .map(normalize)
    .filter(Boolean);
  const itemSet = normalize([item.catalog_group, item.web_slug_group].filter(Boolean).join(" "));
  let score = 0;

  if (targetNumber && itemNumber === targetNumber) {
    score += 45;
  }

  if (nameNeedle && (itemName === nameNeedle || itemName.includes(nameNeedle))) {
    score += 35;
  }

  if (setNeedles.some((set) => itemSet.includes(set))) {
    score += 20;
  }

  return score;
}

export async function fetchCollectrFallbackPrice(
  query: PriceQuery,
  signal?: AbortSignal,
): Promise<ProviderPriceResult | null> {
  if (process.env.COLLECTR_FALLBACK_ENABLED === "false") {
    return null;
  }

  for (const variant of queryVariants(query)) {
    const payload = await fetchCatalog(variant, signal).catch(() => null);
    const candidates = payload?.data ?? [];
    const best = candidates
      .map((item) => ({ item, score: scoreItem(item, query), value: price(item.latest_price ?? item.market_price) }))
      .filter((candidate) => candidate.score >= 70 && candidate.value > 0)
      .sort((left, right) => right.score - left.score || right.value - left.value)[0];

    if (!best) {
      continue;
    }

    return {
      provider: "collectr-fallback",
      sourceLabel: "Collectr catalog",
      ungradedUsd: best.value,
      confidenceScore: 0.56,
      matchConfidence: Math.min(0.94, best.score / 100),
      evidenceType: "guide_snapshot",
      sourceUrl: `https://app.getcollectr.com/explore/product/${best.item.product_id ?? ""}`,
      sampleCount: 1,
      fetchedAt: nowIso(),
    };
  }

  return null;
}
