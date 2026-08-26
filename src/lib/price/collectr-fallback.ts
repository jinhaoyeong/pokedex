import "server-only";

import { buildMarketCardIdentity } from "@/lib/market/card-identity";
import {
  isHostCircuitOpen,
  recordHostFailure,
  recordHostSuccess,
} from "@/lib/market/host-governor";
import { fetchWithEvasion } from "@/lib/network-utils";

import { parseCardFinishId, isFirstEditionFinish } from "@/lib/card-finish";
import { nowIso } from "./providers/shared";
import type { PriceQuery, ProviderPriceResult } from "./types";

type UnknownRecord = Record<string, unknown>;

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
    psa10?: string | number;
    psa_10?: string | number;
    psa9?: string | number;
    psa_9?: string | number;
    psa8?: string | number;
    psa_8?: string | number;
    graded?: unknown;
  };
  grades?: unknown;
  graded_prices?: unknown;
  gradedPrices?: unknown;
  price_guide?: unknown;
  priceGuide?: unknown;
  last_sold?: unknown;
  lastSold?: unknown;
  recent_sales?: unknown;
  recentSales?: unknown;
  comps?: unknown;
  sales?: unknown;
  sold_comps?: unknown;
  soldComps?: unknown;
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
const COLLECTR_HOST = "api-v2.getcollectr.com";
const COLLECTR_COOLDOWN_MS = 60_000;

const FAILOVER_STRESS_COLLECTR_PAYLOAD: CollectrCatalogResponse = {
  data: [
    {
      product_id: "collectr-stress-sv2a-201",
      catalog_category_name: "Pokemon",
      catalog_group: "Pokemon Card 151 Japanese SV2a",
      set: { name: "Pokemon Card 151" },
      product_name: "Charizard ex",
      card_number: "201/165",
      rarity: "Special Illustration Rare",
      is_card: true,
      latest_price: 399.99,
      market_price: 399.99,
      prices: {
        market: 399.99,
        ungraded: 399.99,
        psa10: 899.95,
        psa9: 579.5,
        psa8: 429,
      },
      graded_prices: [
        { service: "PSA", grade: "PSA 10", market_price: 899.95 },
        { service: "PSA", grade: "PSA 9", market_price: 579.5 },
        { service: "PSA", grade: "PSA 8", market_price: 429 },
      ],
      recent_sales: [
        {
          date: "2026-07-02",
          title: "Charizard ex 201/165 SV2a Pokemon 151 Japanese SIR",
          condition: "Ungraded",
          price: 387.25,
          marketplace: "eBay",
          url: "https://www.ebay.com/itm/mock-charizard-sv2a-201",
        },
      ],
    },
  ],
};

function isLocalFailoverStressQuery(query: PriceQuery) {
  return process.env.NODE_ENV !== "production" && query.slug.includes("stress-failover");
}

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

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  const object = record(value);
  return object ? Object.values(object) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? clean(value) : "";
}

function firstString(...values: unknown[]) {
  return values.map(stringValue).find(Boolean) ?? "";
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

function collectrGradePrice(item: CollectrCatalogItem, gradeNumber: 8 | 9 | 10) {
  const gradeKey = `psa${gradeNumber}`;
  const underscoredGradeKey = `psa_${gradeNumber}`;
  const priceKeys = [
    gradeKey,
    underscoredGradeKey,
    `psa-${gradeNumber}`,
    `PSA ${gradeNumber}`,
    `PSA${gradeNumber}`,
    "market",
    "market_price",
    "marketPrice",
    "latest_price",
    "latestPrice",
    "price",
    "value",
  ];

  const directPrices = record(item.prices);
  const direct = price(directPrices?.[gradeKey] ?? directPrices?.[underscoredGradeKey]);

  if (direct) {
    return direct;
  }

  const containers = [
    item.graded_prices,
    item.gradedPrices,
    item.grades,
    item.prices?.graded,
    item.price_guide,
    item.priceGuide,
  ];

  for (const container of containers) {
    const containerRecord = record(container);

    if (containerRecord) {
      const keyed = price(
        containerRecord[gradeKey] ??
          containerRecord[underscoredGradeKey] ??
          containerRecord[`psa-${gradeNumber}`] ??
          containerRecord[`PSA ${gradeNumber}`] ??
          containerRecord[`PSA${gradeNumber}`],
      );

      if (keyed) {
        return keyed;
      }
    }

    for (const entry of array(container)) {
      const entryRecord = record(entry);

      if (!entryRecord) {
        continue;
      }

      const label = normalize(
        firstString(
          entryRecord.grade,
          entryRecord.label,
          entryRecord.name,
          entryRecord.condition,
          entryRecord.serviceGrade,
          entryRecord.service_grade,
        ),
      );
      const service = normalize(firstString(entryRecord.service, entryRecord.grader));
      const grade = firstString(entryRecord.grade_number, entryRecord.gradeNumber);
      const matchesPsa =
        (label.includes(`psa ${gradeNumber}`) || label === `psa${gradeNumber}`) ||
        (service === "psa" && grade === String(gradeNumber));

      if (!matchesPsa) {
        continue;
      }

      for (const key of priceKeys) {
        const value = price(entryRecord[key]);

        if (value) {
          return value;
        }
      }
    }
  }

  return 0;
}

function itemGradedPrices(item: CollectrCatalogItem) {
  return ([10, 9, 8] as const)
    .map((gradeNumber) => {
      const value = collectrGradePrice(item, gradeNumber);

      return value
        ? {
            grade: `PSA ${gradeNumber}`,
            value,
            populationCount: 0,
            source: "Collectr catalog",
            confidence: "medium" as const,
            confidenceScore: 0.58,
            service: "PSA" as const,
            evidenceType: "guide_snapshot" as const,
          }
        : null;
    })
    .filter((gradedPrice): gradedPrice is NonNullable<typeof gradedPrice> => Boolean(gradedPrice));
}

function collectrSalePrice(entry: UnknownRecord) {
  return price(
    entry.price ??
      entry.sold_price ??
      entry.soldPrice ??
      entry.sale_price ??
      entry.salePrice ??
      entry.amount ??
      entry.value ??
      entry.market_price ??
      entry.marketPrice,
  );
}

function itemSales(item: CollectrCatalogItem) {
  const sales = [
    item.last_sold,
    item.lastSold,
    item.recent_sales,
    item.recentSales,
    item.comps,
    item.sales,
    item.sold_comps,
    item.soldComps,
  ].flatMap(array);

  return sales
    .map((sale) => {
      const saleRecord = record(sale);

      if (!saleRecord) {
        return null;
      }

      const salePrice = collectrSalePrice(saleRecord);
      const date = firstString(
        saleRecord.date,
        saleRecord.sold_at,
        saleRecord.soldAt,
        saleRecord.last_sold_at,
        saleRecord.lastSoldAt,
        saleRecord.created_at,
        saleRecord.createdAt,
      );

      if (!salePrice || !date) {
        return null;
      }

      const source = firstString(saleRecord.source, saleRecord.marketplace, saleRecord.platform) || "Collectr";

      return {
        date,
        title: firstString(saleRecord.title, saleRecord.name, saleRecord.product_name) || itemName(item),
        condition: firstString(saleRecord.condition, saleRecord.grade, saleRecord.variant) || "Ungraded",
        price: salePrice,
        source,
        listingUrl: firstString(saleRecord.url, saleRecord.listingUrl, saleRecord.listing_url) || undefined,
        confidence: "medium" as const,
        confidenceScore: 0.58,
        evidenceType: "sold_comp" as const,
      };
    })
    .filter((sale): sale is NonNullable<typeof sale> => Boolean(sale))
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, 12);
}

function providerResultFromItem(best: { item: CollectrCatalogItem; score: number; value: number }) {
  const gradedPrices = itemGradedPrices(best.item);
  const sales = itemSales(best.item);

  return {
    provider: "collectr-fallback",
    sourceLabel: "Collectr catalog",
    ungradedUsd: best.value,
    confidenceScore: 0.56,
    matchConfidence: Math.min(0.94, best.score / 100),
    evidenceType: "guide_snapshot" as const,
    gradedPrices: gradedPrices.length ? gradedPrices : undefined,
    sourceUrl: `https://app.getcollectr.com/explore/product/${itemId(best.item)}`,
    sales: sales.length ? sales : undefined,
    sampleCount: Math.max(1, sales.length),
    fetchedAt: nowIso(),
  };
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

  const finish = parseCardFinishId(query.finish);
  const finishToken = isFirstEditionFinish(finish) ? "1st edition" : "";

  return [
    [name, setCode, number, finishToken].filter(Boolean).join(" "),
    [setCode, number, finishToken].filter(Boolean).join(" "),
    [name, number, query.setEnglishName || query.setName, finishToken].filter(Boolean).join(" "),
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

export function isUsableCollectrCatalogResponse(
  status: number,
  contentType: string | null | undefined,
  body: string,
): boolean {
  if (status === 202 || status < 200 || status >= 300) {
    return false;
  }
  if (!body.trim()) {
    return false;
  }

  const type = (contentType ?? "").toLowerCase();
  if (type && !type.includes("json") && !type.includes("javascript")) {
    return false;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    return Boolean(parsed) && typeof parsed === "object";
  } catch {
    return false;
  }
}

function tripCollectrCooldown() {
  recordHostFailure(COLLECTR_HOST, {
    threshold: 1,
    cooldownMs: COLLECTR_COOLDOWN_MS,
    openImmediately: true,
  });
}

async function fetchCatalogOnce(searchString: string, signal?: AbortSignal) {
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
  const body = await response.text();
  if (!isUsableCollectrCatalogResponse(response.status, response.headers.get("content-type"), body)) {
    return null;
  }

  try {
    return JSON.parse(body) as CollectrCatalogResponse;
  } catch {
    return null;
  }
}

async function fetchCatalog(searchString: string, signal?: AbortSignal) {
  if (isHostCircuitOpen(COLLECTR_HOST)) {
    return null;
  }

  const first = await fetchCatalogOnce(searchString, signal).catch(() => null);
  if (first) {
    recordHostSuccess(COLLECTR_HOST);
    return first;
  }

  const retry = await fetchCatalogOnce(searchString, signal).catch(() => null);
  if (retry) {
    recordHostSuccess(COLLECTR_HOST);
    return retry;
  }

  tripCollectrCooldown();
  return null;
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

  const finish = parseCardFinishId(query.finish);
  const itemIsFirst = /\b1st\b|first edition/i.test(collectrName);
  if (isFirstEditionFinish(finish)) {
    score += itemIsFirst ? 25 : -50;
  } else if (itemIsFirst) {
    score -= 25;
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
    providerResult: best ? providerResultFromItem(best) : null,
  };
}

export async function fetchCollectrFallbackPrice(
  query: PriceQuery,
  signal?: AbortSignal,
): Promise<ProviderPriceResult | null> {
  if (process.env.COLLECTR_FALLBACK_ENABLED === "false") {
    return null;
  }

  if (isLocalFailoverStressQuery(query)) {
    return collectrMatchDebug(query, FAILOVER_STRESS_COLLECTR_PAYLOAD).providerResult;
  }

  if (isHostCircuitOpen(COLLECTR_HOST)) {
    return null;
  }

  for (const variant of queryVariants(query)) {
    const payload = await fetchCatalog(variant, signal).catch(() => null);
    if (isHostCircuitOpen(COLLECTR_HOST)) {
      return null;
    }
    const best = payload ? collectrMatchDebug(query, payload).best : undefined;

    if (!best) {
      continue;
    }

    return providerResultFromItem(best);
  }

  return null;
}
