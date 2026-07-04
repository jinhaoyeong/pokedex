import "server-only";

import { buildMarketCardIdentity } from "@/lib/market/card-identity";
import { fetchWithEvasion } from "@/lib/network-utils";

import { nowIso } from "./providers/shared";
import type { PriceQuery, ProviderPriceResult } from "./types";

type CollectrCatalogItem = {
  product_id?: string | number;
  productId?: string | number;
  catalog_category_name?: string;
  category?: string;
  catalog_group?: string;
  group?: string;
  set?: string | { name?: string; title?: string };
  product_name?: string;
  productName?: string;
  name?: string;
  card_number?: string;
  cardNumber?: string;
  rarity?: string;
  is_card?: boolean;
  isCard?: boolean;
  latest_price?: string | number;
  latestPrice?: string | number;
  market_price?: string | number;
  marketPrice?: string | number;
  prices?: {
    market?: string | number;
    ungraded?: string | number;
    raw?: string | number;
  };
  older_market_price?: string | number;
  web_slug_group?: string;
};

type CollectrCatalogResponse = {
  data?: CollectrCatalogItem[];
  results?: CollectrCatalogItem[];
  products?: CollectrCatalogItem[];
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

function catalogItems(payload: CollectrCatalogResponse | CollectrCatalogItem[] | null | undefined) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return payload?.data ?? payload?.results ?? payload?.products ?? [];
}

function itemId(item: CollectrCatalogItem) {
  return item.product_id ?? item.productId ?? "";
}

function itemName(item: CollectrCatalogItem) {
  return item.product_name ?? item.productName ?? item.name ?? "";
}

function itemNumber(item: CollectrCatalogItem) {
  return item.card_number ?? item.cardNumber ?? "";
}

function itemSetName(item: CollectrCatalogItem) {
  const set = typeof item.set === "string" ? item.set : item.set?.name ?? item.set?.title ?? "";
  return [item.catalog_group, item.group, set, item.web_slug_group].filter(Boolean).join(" ");
}

function itemCategoryName(item: CollectrCatalogItem) {
  return item.catalog_category_name ?? item.category ?? "";
}

function itemIsCard(item: CollectrCatalogItem) {
  return item.is_card ?? item.isCard ?? true;
}

function itemMarketPrice(item: CollectrCatalogItem) {
  return price(
    item.latest_price ??
      item.latestPrice ??
      item.market_price ??
      item.marketPrice ??
      item.prices?.market ??
      item.prices?.ungraded ??
      item.prices?.raw,
  );
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
  if (itemIsCard(item) === false || !/pokemon/i.test(itemCategoryName(item))) {
    return 0;
  }

  const targetNumber = numberBase(query.collectorNumber);
  const collectrNumber = numberBase(itemNumber(item));
  const nameNeedle = normalize(query.englishName || query.name);
  const collectrName = normalize(itemName(item));
  const setNeedles = [query.setEnglishName, query.setName, query.setCode, "151"]
    .map(normalize)
    .filter(Boolean);
  const itemSet = normalize(itemSetName(item));
  let score = 0;

  if (targetNumber && collectrNumber === targetNumber) {
    score += 45;
  }

  if (nameNeedle && (collectrName === nameNeedle || collectrName.includes(nameNeedle))) {
    score += 35;
  }

  if (setNeedles.some((set) => itemSet.includes(set))) {
    score += 20;
  }

  return score;
}

export function collectrMatchDebug(query: PriceQuery, payload: CollectrCatalogResponse | CollectrCatalogItem[]) {
  const variants = queryVariants(query);
  const candidates = catalogItems(payload).map((item) => ({
    item,
    score: scoreItem(item, query),
    value: itemMarketPrice(item),
    normalized: {
      name: itemName(item),
      number: itemNumber(item),
      set: itemSetName(item),
      category: itemCategoryName(item),
    },
  }));
  const best = candidates
    .filter((candidate) => candidate.score >= 70 && candidate.value > 0)
    .sort((left, right) => right.score - left.score || right.value - left.value)[0];

  return {
    variants,
    candidates,
    best,
    providerResult: best
      ? {
          provider: "collectr-fallback",
          sourceLabel: "Collectr catalog",
          ungradedUsd: best.value,
          confidenceScore: 0.56,
          matchConfidence: Math.min(0.94, best.score / 100),
          evidenceType: "guide_snapshot" as const,
          sourceUrl: `https://app.getcollectr.com/explore/product/${itemId(best.item)}`,
          sampleCount: 1,
          fetchedAt: nowIso(),
        }
      : null,
  };
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
    const best = payload ? collectrMatchDebug(query, payload).best : undefined;

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
      sourceUrl: `https://app.getcollectr.com/explore/product/${itemId(best.item)}`,
      sampleCount: 1,
      fetchedAt: nowIso(),
    };
  }

  return null;
}
