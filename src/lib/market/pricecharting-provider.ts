import "server-only";

import {
  buildMarketCardIdentity,
  priceChartingProductMatchesIdentity,
  type MarketCardIdentity,
  type MarketCardIdentityInput,
} from "@/lib/market/card-identity";
import {
  readMarketFileCache,
  writeMarketFileCache,
} from "@/lib/market/file-cache.server";
import { fetchMarketJson, fetchMarketText, MarketHttpError } from "@/lib/market/http-client";
import { fetchOpenSourceMarketFallback } from "@/lib/market/open-source-market-provider";
import type {
  GradedPrice,
  GradingService,
  MarketSourceStatus,
  PsaPopulationSnapshot,
} from "@/types/pokemon";

type PriceChartingProduct = Record<string, unknown> & {
  status?: string;
  id?: string | number;
  "product-name"?: string;
  "console-name"?: string;
  "loose-price"?: number;
};

type PriceChartingProductsResponse = {
  status?: string;
  products?: PriceChartingProduct[];
  "error-message"?: string;
};

export type PriceChartingProductResult = {
  identity: MarketCardIdentity;
  product: PriceChartingProduct;
  query: string;
  productUrl: string;
};

const PRICECHARTING_DEFAULT_BASE_URL = "https://www.pricecharting.com";
const PRICECHARTING_API_MIN_INTERVAL_MS = Number(
  process.env.PRICECHARTING_API_MIN_INTERVAL_MS ?? "1100",
);
const PRICECHARTING_API_TIMEOUT_MS = Number(process.env.PRICECHARTING_API_TIMEOUT_MS ?? "10000");
const PRICECHARTING_PUBLIC_CACHE_TTL_MS = Number(
  process.env.PRICECHARTING_PUBLIC_CACHE_TTL_MS ?? String(24 * 60 * 60 * 1000),
);
let lastPriceChartingCallAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function apiToken() {
  return (
    process.env.PRICECHARTING_API_KEY?.trim() ||
    process.env.PRICECHARTING_API_TOKEN?.trim() ||
    ""
  );
}

export function isPriceChartingApiConfigured() {
  return Boolean(apiToken());
}

function apiBaseUrl() {
  const configuredApi = process.env.PRICECHARTING_API_BASE_URL?.trim();
  if (configuredApi) {
    return configuredApi.replace(/\/$/, "");
  }

  return `${(process.env.PRICECHARTING_BASE_URL?.trim() || PRICECHARTING_DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  )}/api`;
}

function productUrl(id: string | number | undefined, query: string) {
  const url = new URL(`${apiBaseUrl()}/product`);
  url.searchParams.set("t", apiToken());

  if (id != null && String(id).trim()) {
    url.searchParams.set("id", String(id));
  } else {
    url.searchParams.set("q", query);
  }

  return url.toString();
}

function productsUrl(query: string) {
  const url = new URL(`${apiBaseUrl()}/products`);
  url.searchParams.set("t", apiToken());
  url.searchParams.set("q", query);
  return url.toString();
}

async function waitForPriceChartingBudget(signal?: AbortSignal) {
  const elapsed = Date.now() - lastPriceChartingCallAt;
  const waitMs = PRICECHARTING_API_MIN_INTERVAL_MS - elapsed;

  if (waitMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("PriceCharting request aborted"));
        },
        { once: true },
      );
    });
  }

  lastPriceChartingCallAt = Date.now();
}

async function fetchPriceChartingJson<T>(url: string, signal?: AbortSignal) {
  await waitForPriceChartingBudget(signal);
  return fetchMarketJson<T>(url, {
    language: "en",
    signal,
    timeoutMs: PRICECHARTING_API_TIMEOUT_MS,
  });
}

function cents(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round((value / 100) * 100) / 100;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^0-9-]/g, ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round((parsed / 100) * 100) / 100 : 0;
  }

  return 0;
}

function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^0-9-]/g, ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

function sourceUrl(product: PriceChartingProduct) {
  const base = (process.env.PRICECHARTING_BASE_URL?.trim() || PRICECHARTING_DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const id = product.id != null ? String(product.id) : "";
  return id ? `${base}/offers?seller=&status=sold&id=${encodeURIComponent(id)}` : base;
}

function sourceStatus(input: {
  source?: string;
  state: MarketSourceStatus["state"];
  confidenceScore: number;
  note: string;
  sourceUrl?: string;
  sampleCount?: number;
  warning?: string;
}): MarketSourceStatus {
  return {
    source: input.source ?? "PriceCharting API",
    state: input.state,
    confidence:
      input.confidenceScore >= 0.68 ? "high" : input.confidenceScore >= 0.4 ? "medium" : "low",
    confidenceScore: input.confidenceScore,
    fetchedAt: nowIso(),
    note: input.note,
    sourceUrl: input.sourceUrl,
    sampleCount: input.sampleCount,
    warning: input.warning,
  };
}

function priceChartingBaseUrl() {
  return (process.env.PRICECHARTING_BASE_URL?.trim() || PRICECHARTING_DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
}

function slugifyPathPart(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function publicPageUrl(identity: MarketCardIdentity) {
  const setSlug =
    identity.priceChartingSetSlug ||
    `pokemon-${slugifyPathPart(identity.englishSetName || identity.nativeSetName)}`;
  const nameSlug = slugifyPathPart(identity.englishName || identity.nativeName);
  const numberSlug = slugifyPathPart(identity.numberBase || identity.collectorNumber);

  if (!setSlug || !nameSlug || !numberSlug) {
    return null;
  }

  return `${priceChartingBaseUrl()}/game/${setSlug}/${nameSlug}-${numberSlug}`;
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|td|th|li|div|p|h1)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function dollars(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

function parsePublicLabels(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const cleanH1 = stripHtml(h1);
  const [productPart, consolePart] = title.split("|").map((part) => part.trim());

  return {
    "product-name": cleanH1 || productPart?.replace(/\s+Prices$/i, "") || "",
    "console-name": consolePart?.replace(/\s+Pokemon Cards$/i, "") || "",
  };
}

function publicPageMatchesIdentity(identity: MarketCardIdentity, html: string) {
  return priceChartingProductMatchesIdentity(identity, parsePublicLabels(html));
}

function priceEntries(segment: string) {
  return [...segment.matchAll(/\$([0-9][0-9,.]*)/g)]
    .filter((match) => {
      const index = match.index ?? 0;
      const previous = segment[index - 1] ?? "";
      return previous !== "+" && previous !== "-";
    })
    .map((match) => dollars(match[1]))
    .filter((value) => value > 0);
}

function parsePublicPrices(html: string, source: string): GradedPrice[] {
  const text = stripHtml(html);
  const priceGrid = text.match(
    /Ungraded\s+Grade 7\s+Grade 8\s+Grade 9\s+Grade 9\.5\s+PSA 10\s+([\s\S]{0,500}?)(?:volume:|Compare Prices|Sold Listings)/i,
  )?.[1];
  const values = priceGrid ? priceEntries(priceGrid) : [];
  const labels: Array<{ grade: string; service: GradingService; confidenceScore: number }> = [
    { grade: "Ungraded", service: "RAW", confidenceScore: 0.58 },
    { grade: "PSA 7", service: "PSA", confidenceScore: 0.58 },
    { grade: "PSA 8", service: "PSA", confidenceScore: 0.58 },
    { grade: "PSA 9", service: "PSA", confidenceScore: 0.62 },
    { grade: "PSA 9.5", service: "PSA", confidenceScore: 0.56 },
    { grade: "PSA 10", service: "PSA", confidenceScore: 0.68 },
  ];

  return labels.flatMap((label, index) => {
    const value = values[index] ?? 0;
    if (!(value > 0)) {
      return [];
    }

    return [
      {
        grade: label.grade,
        value,
        populationCount: 0,
        source: "PriceCharting public page",
        saleCount: 0,
        lastSoldAt: null,
        service: label.service,
        confidence: "medium" as const,
        confidenceScore: label.confidenceScore,
        evidenceType: "guide_snapshot" as const,
        sourceUrl: source,
      },
    ];
  });
}

function pushPopulationRow(
  rows: PsaPopulationSnapshot["grades"],
  source: string,
  service: "PSA" | "CGC" | "BGS",
  grade: string,
  rowCount: number | null,
) {
  if (rowCount == null || rowCount < 0) {
    return;
  }

  const label = `${service} ${grade}`;
  if (rows.some((row) => row.grade === label)) {
    return;
  }

  rows.push({
    grade: label,
    count: rowCount,
    service,
    confidence: "medium",
    confidenceScore: 0.6,
    evidenceType: "population",
    sourceUrl: source,
  });
}

function parsePublicPopulationForService(
  html: string,
  service: "PSA" | "CGC" | "BGS",
  source: string,
): PsaPopulationSnapshot | null {
  const text = stripHtml(html);
  const grades: PsaPopulationSnapshot["grades"] = [];
  const serviceIndex: Record<typeof service, number> = { PSA: 1, CGC: 2, BGS: 4 } as Record<
    typeof service,
    number
  >;

  for (const match of text.matchAll(
    /\b(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)\s+(-|[0-9][0-9,]*)\s+(-|[0-9][0-9,]*)\s+(-|[0-9][0-9,]*)(?:\s+(-|[0-9][0-9,]*))?/g,
  )) {
    const value = match[serviceIndex[service]];
    pushPopulationRow(grades, source, service, match[1], count(value));
  }

  for (const match of text.matchAll(
    new RegExp(`\\b${service}\\s+(10|9\\.5|9|8\\.5|8|7\\.5|7|6|5|4|3|2|1)\\b[^0-9]{0,80}([0-9][0-9,]*)`, "gi"),
  )) {
    pushPopulationRow(grades, source, service, match[1], count(match[2]));
  }

  const totalCertified = grades.length
    ? grades.reduce((sum, grade) => sum + grade.count, 0)
    : null;

  if (totalCertified == null) {
    return null;
  }

  return {
    status: "verified",
    totalCertified,
    grades,
    source: "PriceCharting public page",
    fetchedAt: nowIso(),
    sourceUrl: source,
    note: `${service} population parsed from PriceCharting's public page when accessible without bypassing protections.`,
    service,
    confidence: "medium",
    confidenceScore: grades.length ? 0.58 : 0.3,
    evidenceType: "population",
  };
}

type PublicPageCacheValue = {
  url: string;
  fetchedAt: string;
  gradedPrices: GradedPrice[];
  populations: Partial<Record<"PSA" | "CGC" | "BGS", PsaPopulationSnapshot>>;
};

async function fetchPriceChartingPublicPage(
  identity: MarketCardIdentity,
  signal?: AbortSignal,
): Promise<PublicPageCacheValue | null> {
  const url = publicPageUrl(identity);
  if (!url) {
    return null;
  }

  const cacheKey = `${identity.key}|${url}`;
  const cached = await readMarketFileCache<PublicPageCacheValue>(
    "pricecharting-public",
    cacheKey,
    PRICECHARTING_PUBLIC_CACHE_TTL_MS,
  );

  if (cached) {
    return cached;
  }

  const html = await fetchMarketText(url, {
    accept: "html",
    language: identity.language,
    signal,
    timeoutMs: 12_000,
  });

  if (!publicPageMatchesIdentity(identity, html)) {
    return null;
  }

  const value: PublicPageCacheValue = {
    url,
    fetchedAt: nowIso(),
    gradedPrices: parsePublicPrices(html, url),
    populations: {
      PSA: parsePublicPopulationForService(html, "PSA", url) ?? undefined,
      CGC: parsePublicPopulationForService(html, "CGC", url) ?? undefined,
      BGS: parsePublicPopulationForService(html, "BGS", url) ?? undefined,
    },
  };

  await writeMarketFileCache("pricecharting-public", cacheKey, value);
  return value;
}

function firstMatchingProduct(
  identity: MarketCardIdentity,
  products: PriceChartingProduct[] | undefined,
) {
  return (products ?? []).find((product) => priceChartingProductMatchesIdentity(identity, product));
}

export async function fetchPriceChartingProduct(
  input: MarketCardIdentityInput,
  signal?: AbortSignal,
): Promise<PriceChartingProductResult | null> {
  if (!isPriceChartingApiConfigured()) {
    return null;
  }

  const identity = buildMarketCardIdentity(input);

  for (const query of identity.priceChartingQueries) {
    const search = await fetchPriceChartingJson<PriceChartingProductsResponse>(
      productsUrl(query),
      signal,
    );

    if (search?.status === "error") {
      continue;
    }

    const match = firstMatchingProduct(identity, search?.products);
    if (!match) {
      continue;
    }

    const full =
      match.id != null
        ? await fetchPriceChartingJson<PriceChartingProduct>(productUrl(match.id, query), signal)
        : await fetchPriceChartingJson<PriceChartingProduct>(productUrl(undefined, query), signal);

    const product = full?.status === "error" || !full ? match : full;
    if (!priceChartingProductMatchesIdentity(identity, product)) {
      continue;
    }

    return {
      identity,
      product,
      query,
      productUrl: productUrl(product.id, query),
    };
  }

  return null;
}

type PriceField = {
  grade: string;
  service: GradingService;
  keys: string[];
};

const PRICE_FIELDS: PriceField[] = [
  { grade: "Ungraded", service: "RAW", keys: ["loose-price", "ungraded-price"] },
  { grade: "PSA 10", service: "PSA", keys: ["psa-10-price", "psa10-price", "manual-only-price", "condition-7-price"] },
  { grade: "PSA 9.5", service: "PSA", keys: ["psa-9.5-price", "psa95-price"] },
  { grade: "PSA 9", service: "PSA", keys: ["psa-9-price", "psa9-price", "graded-price", "condition-5-price"] },
  { grade: "PSA 8", service: "PSA", keys: ["psa-8-price", "psa8-price", "new-price", "condition-2-price"] },
  { grade: "PSA 7", service: "PSA", keys: ["psa-7-price", "psa7-price", "cib-price", "condition-3-price"] },
  { grade: "CGC 10", service: "CGC", keys: ["cgc-10-price", "cgc10-price", "condition-17-price"] },
  { grade: "BGS 10", service: "BGS", keys: ["bgs-10-price", "bgs10-price", "condition-8-price"] },
];

export function parsePriceChartingGradedPrices(
  product: PriceChartingProduct,
  productSourceUrl = sourceUrl(product),
): GradedPrice[] {
  return PRICE_FIELDS.flatMap((field) => {
    const value = field.keys.map((key) => cents(product[key])).find((price) => price > 0) ?? 0;
    if (!(value > 0)) {
      return [];
    }

    return [
      {
        grade: field.grade,
        value,
        populationCount: 0,
        source: "PriceCharting API",
        saleCount: count(product["sales-volume"]) ?? 0,
        lastSoldAt: null,
        service: field.service,
        confidence: "medium" as const,
        confidenceScore: field.service === "RAW" ? 0.64 : 0.68,
        evidenceType: "guide_snapshot" as const,
        sourceUrl: productSourceUrl,
      },
    ];
  });
}

function populationKeys(service: "PSA" | "CGC" | "BGS", grade: string) {
  const normalized = grade.replace(/\s+/g, "-").toLowerCase();
  const compact = normalized.replace(".", "");
  const serviceLower = service.toLowerCase();
  return [
    `${serviceLower}-population-${normalized}`,
    `${serviceLower}-${normalized}-population`,
    `${serviceLower}-pop-${normalized}`,
    `${serviceLower}-${normalized}-pop`,
    `${serviceLower}-${compact}-population`,
    `${serviceLower}-${compact}-pop`,
    `population-${serviceLower}-${normalized}`,
    `pop-${serviceLower}-${normalized}`,
  ];
}

function nestedPopulationCount(product: PriceChartingProduct, service: "PSA" | "CGC" | "BGS", grade: string) {
  const containers = [
    product.population,
    product.populations,
    product["population-report"],
    product["population-counts"],
  ].filter((value): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value)),
  );
  const serviceKeys = [service, service.toLowerCase()];
  const gradeKeys = [grade, grade.replace(/\s+/g, "-"), grade.replace(/\s+/g, "").replace(".", "")];

  for (const container of containers) {
    for (const serviceKey of serviceKeys) {
      const serviceValue = container[serviceKey];
      if (serviceValue && typeof serviceValue === "object" && !Array.isArray(serviceValue)) {
        for (const gradeKey of gradeKeys) {
          const value = (serviceValue as Record<string, unknown>)[gradeKey];
          const parsed = count(value);
          if (parsed != null) {
            return parsed;
          }
        }
      }
    }
  }

  return null;
}

function populationCount(product: PriceChartingProduct, service: "PSA" | "CGC" | "BGS", grade: string) {
  for (const key of populationKeys(service, grade)) {
    const parsed = count(product[key]);
    if (parsed != null) {
      return parsed;
    }
  }

  return nestedPopulationCount(product, service, grade);
}

const POPULATION_GRADES: Record<"PSA" | "CGC" | "BGS", string[]> = {
  PSA: ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6", "5", "4", "3", "2", "1"],
  CGC: ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6", "5", "4", "3", "2", "1"],
  BGS: ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6", "5", "4", "3", "2", "1"],
};

export function parsePriceChartingPopulation(
  product: PriceChartingProduct,
  service: "PSA" | "CGC" | "BGS",
  productSourceUrl = sourceUrl(product),
): PsaPopulationSnapshot | null {
  const grades = POPULATION_GRADES[service].flatMap((grade) => {
    const parsed = populationCount(product, service, grade);
    if (parsed == null) {
      return [];
    }

    return [
      {
        grade: `${service} ${grade}`,
        count: parsed,
        service,
        confidence: "medium" as const,
        confidenceScore: 0.68,
        evidenceType: "population" as const,
        sourceUrl: productSourceUrl,
      },
    ];
  });
  const explicitTotal =
    count(product[`${service.toLowerCase()}-population-total`]) ??
    count(product[`${service.toLowerCase()}-pop-total`]) ??
    count(product[`population-${service.toLowerCase()}-total`]);
  const totalCertified =
    explicitTotal ?? (grades.length ? grades.reduce((sum, grade) => sum + grade.count, 0) : null);

  if (totalCertified == null && !grades.length) {
    return null;
  }

  return {
    status: "verified",
    totalCertified,
    grades,
    source: "PriceCharting API",
    fetchedAt: nowIso(),
    sourceUrl: productSourceUrl,
    note: `${service} population normalized from the official PriceCharting API product response.`,
    service,
    confidence: grades.length || totalCertified === 0 ? "medium" : "low",
    confidenceScore: grades.length ? 0.68 : totalCertified === 0 ? 0.52 : 0.3,
    evidenceType: "population",
  };
}

export async function fetchPriceChartingPopulation(
  input: MarketCardIdentityInput,
  service: "PSA" | "CGC" | "BGS",
  signal?: AbortSignal,
) {
  if (!isPriceChartingApiConfigured()) {
    const identity = buildMarketCardIdentity(input);

    try {
      const publicPage = await fetchPriceChartingPublicPage(identity, signal);
      const population = publicPage?.populations[service] ?? null;

      return {
        population,
        sourceStatus: sourceStatus({
          source: "PriceCharting public page",
          state: population ? "ready" : "no_match",
          confidenceScore: population?.confidenceScore ?? 0.26,
          note: population
            ? `${service} population was parsed from a cached/free PriceCharting public page.`
            : `PriceCharting public page had no verified ${service} population match for this card.`,
          sourceUrl: publicPage?.url,
          sampleCount: population?.grades.length ?? 0,
        }),
      };
    } catch (error) {
      const blocked = error instanceof MarketHttpError && error.code === "blocked";
      return {
        population: null,
        sourceStatus: sourceStatus({
          source: "PriceCharting public page",
          state: blocked ? "failed" : "no_match",
          confidenceScore: 0.18,
          note: blocked
            ? "PriceCharting blocked the public page request; no bypass was attempted."
            : `PriceCharting public page could not be read for ${service} population.`,
          warning: error instanceof Error ? error.message : "Unknown public page error",
        }),
      };
    }
  }

  const result = await fetchPriceChartingProduct(input, signal);
  if (!result) {
    return {
      population: null,
      sourceStatus: sourceStatus({
        state: "no_match",
        confidenceScore: 0.24,
        note: `PriceCharting API returned no verified ${service} product match for this exact card identity.`,
      }),
    };
  }

  const productSourceUrl = sourceUrl(result.product);
  const population = parsePriceChartingPopulation(result.product, service, productSourceUrl);
  return {
    population,
    sourceStatus: sourceStatus({
      state: population ? "ready" : "no_match",
      confidenceScore: population?.confidenceScore ?? 0.28,
      note: population
        ? `${service} population came from PriceCharting API product ${String(result.product.id ?? "")}.`
        : `PriceCharting API matched the product, but did not include ${service} population fields.`,
      sourceUrl: productSourceUrl,
      sampleCount: population?.grades.length ?? 0,
    }),
  };
}

export async function fetchPriceChartingMarketPrice(
  input: MarketCardIdentityInput,
  signal?: AbortSignal,
) {
  if (!isPriceChartingApiConfigured()) {
    const identity = buildMarketCardIdentity(input);
    const publicPage = await fetchPriceChartingPublicPage(identity, signal).catch(() => null);
    const ungraded = publicPage?.gradedPrices.find((price) => price.grade === "Ungraded");

    if (publicPage && ungraded?.value) {
      return {
        result: null,
        ungradedUsd: ungraded.value,
        gradedPrices: publicPage.gradedPrices,
        sourceUrl: publicPage.url,
        sourceLabel: "PriceCharting public page",
        evidenceType: "guide_snapshot" as const,
        confidenceScore: 0.58,
        matchConfidence: 0.9,
      };
    }

    const fallback = await fetchOpenSourceMarketFallback(input, signal);
    if (!fallback) {
      return null;
    }

    return {
      result: null,
      ungradedUsd: fallback.ungradedUsd,
      gradedPrices: fallback.gradedPrices,
      sourceUrl: fallback.sourceUrl,
      sourceLabel: fallback.sourceLabel,
      evidenceType: "catalog" as const,
      confidenceScore: fallback.confidenceScore,
      matchConfidence: fallback.matchConfidence,
    };
  }

  const result = await fetchPriceChartingProduct(input, signal);
  if (!result) {
    return null;
  }

  const productSourceUrl = sourceUrl(result.product);
  const gradedPrices = parsePriceChartingGradedPrices(result.product, productSourceUrl);
  const ungraded = gradedPrices.find((price) => price.grade === "Ungraded");

  if (!ungraded?.value) {
    return null;
  }

  return {
    result,
    ungradedUsd: ungraded.value,
    gradedPrices,
    sourceUrl: productSourceUrl,
    sourceLabel: "PriceCharting API",
    evidenceType: "guide_snapshot" as const,
    confidenceScore: 0.62,
    matchConfidence: 0.9,
  };
}
