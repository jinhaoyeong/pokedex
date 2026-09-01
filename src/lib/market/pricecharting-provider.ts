import "server-only";

import {
  getPriceChartingSetSlugVariants,
  rankPriceChartingSetSlugs,
} from "@/lib/localized-set-market";
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
import { fetchMarketJson, MarketHttpError } from "@/lib/market/http-client";
import { classifySoldCompJunk, filterJunkSoldComps } from "@/lib/market/sold-comp-hygiene";
import { hasPricedMarketPayload } from "@/lib/price/priced-payload";
import {
  fetchPublicPageText,
  isPublicPageTransportBanError,
} from "@/lib/public-page-fetch";
import {
  productUrlMatchesFinish,
  withPriceChartingFinishSuffixes,
} from "@/lib/card-finish";
import type {
  GradedPrice,
  GradingService,
  MarketSourceStatus,
  PsaPopulationSnapshot,
  SaleRecord,
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
  productId?: string;
  productUrl?: string;
  setSlug?: string;
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

function apiProductUrl(id: string | number | undefined, query: string) {
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

async function fetchPriceChartingJson<T>(
  url: string,
  signal?: AbortSignal,
  options: { skipThrottle?: boolean } = {},
) {
  if (!options.skipThrottle) {
    await waitForPriceChartingBudget(signal);
  } else {
    lastPriceChartingCallAt = Date.now();
  }
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

function cleanProductId(value: unknown) {
  const clean = value == null ? "" : String(value).trim();
  return /^\d+$/.test(clean) ? clean : undefined;
}

function setSlugFromProductUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (!/(^|\.)pricecharting\.com$/i.test(url.hostname)) {
      return undefined;
    }

    return url.pathname.match(/^\/game\/([^/]+)\//i)?.[1];
  } catch {
    return undefined;
  }
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

function publicPageNameSeeds(identity: MarketCardIdentity) {
  const seeds = [
    identity.englishName,
    identity.nativeName,
    // PriceCharting often keeps a possessive "s" without the apostrophe ("azs-serenity"),
    // and also encodes apostrophes as %27 in some product paths ("az%27s-tranquility").
    identity.englishName?.replace(/['’]s\b/gi, "s"),
    identity.englishName?.replace(/['’]/g, " "),
    identity.englishName?.replace(/['’]/g, "%27"),
  ];

  for (const seed of [...seeds]) {
    if (!seed) {
      continue;
    }
    // Catalog finish suffixes ("… Gold") are not part of PriceCharting product slugs.
    if (!/\bgold\s+star\b/i.test(seed)) {
      seeds.push(seed.replace(/\s+\b(?:gold|silver|rainbow)\s*$/i, "").trim());
    }
    seeds.push(
      seed
        .replace(/\b(?:full\s+art|alternate\s+art|holo|promo)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  return [...new Set(seeds.filter((value): value is string => Boolean(value?.trim())))];
}

function publicPageUrlCandidates(identity: MarketCardIdentity) {
  const setSlugs = rankPriceChartingSetSlugs([
    identity.setSlug,
    identity.priceChartingSetSlug,
    ...getPriceChartingSetSlugVariants(identity.englishSetName || identity.nativeSetName, {
      setCode: identity.setCode,
      language: identity.language,
    }),
  ]);
  const numberSlug = slugifyPathPart(identity.numberBase || identity.collectorNumber);
  const nameSeeds = publicPageNameSeeds(identity);

  const urls: string[] = [];
  const seen = new Set<string>();

  const pushUrl = (url: string) => {
    if (!url || seen.has(url) || !productUrlMatchesFinish(url, identity.finish, identity.rarity)) {
      return;
    }
    seen.add(url);
    urls.push(url);
  };

  if (identity.productUrl) {
    for (const url of withPriceChartingFinishSuffixes(identity.productUrl, identity.finish, identity.rarity)) {
      pushUrl(url);
    }
  }

  for (const setSlug of setSlugs.slice(0, 4)) {
    for (const seed of nameSeeds) {
      const nameSlug = seed.includes("%27")
        ? seed
            .normalize("NFKD")
            .toLowerCase()
            .replace(/&/g, " ")
            .replace(/[^a-z0-9%]+/g, "-")
            .replace(/(^-|-$)+/g, "")
        : slugifyPathPart(seed);
      if (!setSlug || !nameSlug) {
        continue;
      }

      if (numberSlug) {
        const baseUrl = `${priceChartingBaseUrl()}/game/${setSlug}/${nameSlug}-${numberSlug}`;
        for (const url of withPriceChartingFinishSuffixes(baseUrl, identity.finish, identity.rarity)) {
          pushUrl(url);
        }
      }

      // Japanese unique-name product pages often omit the number
      // (`/game/pokemon-japanese-awakening-legends/ampharos`).
      if (identity.language === "ja") {
        const nameOnly = `${priceChartingBaseUrl()}/game/${setSlug}/${nameSlug}`;
        for (const url of withPriceChartingFinishSuffixes(nameOnly, identity.finish, identity.rarity)) {
          pushUrl(url);
        }
      }
    }
  }

  return urls;
}

function publicPageUrl(identity: MarketCardIdentity) {
  return publicPageUrlCandidates(identity)[0] ?? null;
}

function extractVgpcObjectLiteral(html: string, key: "pop_price_data" | "pop_data") {
  const needle = `VGPC.${key}`;
  const start = html.indexOf(needle);
  if (start < 0) {
    return null;
  }

  const brace = html.indexOf("{", start);
  if (brace < 0 || brace - start > 80) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  const limit = Math.min(html.length, brace + 250_000);
  for (let i = brace; i < limit; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(brace, i + 1);
      }
    }
  }

  return null;
}

export function extractPriceChartingVgpcObject(
  html: string,
  key: "pop_price_data" | "pop_data" = "pop_price_data",
) {
  return extractVgpcObjectLiteral(html, key);
}

function soldListingsSlice(html: string) {
  const markers = ["Sold Listings", "completed sales", "js-completed-sales", "Recent Sales"];
  let start = -1;
  for (const marker of markers) {
    start = html.indexOf(marker);
    if (start >= 0) {
      break;
    }
  }
  if (start < 0) {
    start = html.search(/\d{4}-\d{2}-\d{2}/);
  }
  if (start < 0) {
    return html.length > 180_000 ? "" : html;
  }
  return html.slice(start, start + 180_000);
}

function guidePriceSlice(html: string) {
  const ungraded = html.search(/Ungraded/i);
  if (ungraded < 0) {
    return html.length > 180_000 ? html.slice(0, 180_000) : html;
  }
  return html.slice(Math.max(0, ungraded - 400), ungraded + 12_000);
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
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
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
  // Jina reader returns markdown with `Title: … | Console` instead of HTML tags.
  const jinaTitle = html.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const title =
    jinaTitle || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
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
  const raw = [...segment.matchAll(/\$([0-9][0-9,.]*)/g)]
    .filter((match) => {
      const index = match.index ?? 0;
      const previous = segment[index - 1] ?? "";
      return previous !== "+" && previous !== "-";
    })
    .map((match) => dollars(match[1]));

  // PriceCharting often renders each grade as "current price" followed by a daily delta.
  const pairedGuidePrices =
    raw.length >= 12 && raw.length % 2 === 0
      ? raw.filter((_, index) => index % 2 === 0)
      : raw;

  return pairedGuidePrices.filter((value) => value > 0);
}

function parseMarkdownGuideTablePrices(html: string): number[] {
  // Jina markdown: header row + separator + `$1.73 -$0.05 | - | … | $38.57 +$0.33`
  const lines = html.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) =>
      line.includes("|") && /Ungraded/i.test(line) && /PSA\s*10|Grade\s*9/i.test(line),
  );

  if (headerIndex < 0) {
    return [];
  }

  const priceLine = lines
    .slice(headerIndex + 1, headerIndex + 5)
    .find((line) => /\$[0-9]/.test(line));

  if (!priceLine) {
    return [];
  }

  const cells = priceLine
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0 && !/^\[/.test(cell));

  return cells.map((cell) => {
    if (/^-+$/.test(cell) || cell === "-") {
      return 0;
    }

    // Prefer the leading guide price; ignore trailing daily deltas like -$0.05 / +$0.10.
    const match = cell.match(/\$([0-9][0-9,.]*)/);
    return dollars(match?.[1]);
  });
}

function parsePublicPrices(html: string, source: string): GradedPrice[] {
  const markdownValues = parseMarkdownGuideTablePrices(html);
  const values = markdownValues.some((value) => value > 0)
    ? markdownValues
    : (() => {
        const text = stripHtml(guidePriceSlice(html));
        const priceGrid = text.match(
          /Ungraded\s+Grade 7\s+Grade 8\s+Grade 9\s+Grade 9\.5\s+PSA 10\s+([\s\S]{0,500}?)(?:volume:|Compare Prices|Sold Listings)/i,
        )?.[1];
        return priceGrid ? priceEntries(priceGrid) : [];
      })();
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

export function parsePriceChartingEmbeddedPopulation(
  html: string,
  source: string,
): PsaPopulationSnapshot | null {
  const raw =
    extractVgpcObjectLiteral(html, "pop_price_data") ??
    extractVgpcObjectLiteral(html, "pop_data");
  if (!raw) {
    return null;
  }

  let data: { psa?: number[]; cgc?: number[]; prices?: number[] };
  try {
    data = JSON.parse(raw) as { psa?: number[]; cgc?: number[]; prices?: number[] };
  } catch {
    return null;
  }

  const psaCounts = data.psa ?? [];
  const cgcCounts = data.cgc ?? [];
  if (psaCounts.length < 10 && cgcCounts.length < 10) {
    return null;
  }

  const grades: PsaPopulationSnapshot["grades"] = [];
  for (let index = 0; index < 10; index += 1) {
    const gradeNum = index + 1;
    const psaCount = psaCounts[index] ?? 0;
    const cgcCount = cgcCounts[index] ?? 0;
    if (psaCount > 0) {
      grades.push({
        grade: `PSA ${gradeNum}`,
        count: psaCount,
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.72,
        evidenceType: "population",
        sourceUrl: source,
      });
    }
    if (cgcCount > 0) {
      grades.push({
        grade: `CGC ${gradeNum}`,
        count: cgcCount,
        service: "CGC",
        confidence: "medium",
        confidenceScore: 0.68,
        evidenceType: "population",
        sourceUrl: source,
      });
    }
  }

  const totalCertified = grades.reduce((sum, grade) => sum + grade.count, 0);
  if (!grades.length || totalCertified <= 0) {
    return null;
  }

  const hasPsa = grades.some((grade) => grade.service === "PSA");
  const hasCgc = grades.some((grade) => grade.service === "CGC");

  return {
    status: "verified",
    totalCertified,
    grades,
    source: "PriceCharting public population report",
    fetchedAt: nowIso(),
    sourceUrl: source,
    note:
      hasPsa && hasCgc
        ? "PSA and CGC grade counts were parsed from PriceCharting's embedded population data on the product page."
        : hasPsa
          ? "PSA grade counts were parsed from PriceCharting's embedded population data on the product page."
          : "CGC grade counts were parsed from PriceCharting's embedded population data on the product page.",
    service: hasPsa && !hasCgc ? "PSA" : hasCgc && !hasPsa ? "CGC" : undefined,
    confidence: "medium",
    confidenceScore: hasPsa ? 0.72 : 0.68,
    evidenceType: "population",
  };
}

function parsePublicPopulationForService(
  html: string,
  service: "PSA" | "CGC" | "BGS",
  source: string,
): PsaPopulationSnapshot | null {
  if (html.length > 250_000) {
    return null;
  }
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
  recentSales?: SaleRecord[];
  populations: Partial<Record<"PSA" | "CGC" | "BGS", PsaPopulationSnapshot>>;
  population?: PsaPopulationSnapshot | null;
};

export type PriceChartingSaleRejectionReason =
  | "identity_name_mismatch"
  | "identity_variant_mismatch"
  | "identity_collector_mismatch"
  | "identity_set_mismatch"
  | "identity_language_mismatch"
  | "junk_signed_autograph"
  | "junk_metal_jumbo_promo"
  | "junk_damaged_slab"
  | "junk_bundle_proxy"
  | "invalid_sale_date"
  | "invalid_sale_price"
  | "missing_listing_url"
  | "unsupported_graded_condition";

export type PriceChartingSaleParseResult = {
  sales: SaleRecord[];
  candidateCount: number;
  rejectedReasonCounts: Partial<Record<PriceChartingSaleRejectionReason, number>>;
};

const SALE_NAME_STOPWORDS = new Set(["a", "an", "card", "cards", "pokemon", "tcg", "the"]);
const SALE_CARD_VARIANTS = new Set([
  "break",
  "ex",
  "gx",
  "lv",
  "mega",
  "prime",
  "radiant",
  "v",
  "vmax",
  "vstar",
]);

function normalizeSaleText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function saleTokens(value: string) {
  return normalizeSaleText(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function escapeRegex(value: string) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function saleLanguageMatchesIdentity(identity: MarketCardIdentity, title: string) {
  const lower = normalizeSaleText(title).toLowerCase();
  const hasJapanese =
    /\b(?:japan|japanese|jp)\b/i.test(lower) || /[\u3040-\u30ff]/u.test(lower);
  const hasKorean = /\b(?:korea|korean|kr)\b/i.test(lower) || /[\uac00-\ud7af]/u.test(lower);
  const hasChinese =
    /\b(?:china|chinese|simplified|traditional|cn|tw)\b/i.test(lower);
  const hasEnglish = /\b(?:english|eng)\b/i.test(lower);

  if (identity.language === "en") {
    return !hasJapanese && !hasKorean && !hasChinese;
  }

  if (identity.language === "ja") {
    const setCode = identity.setCode?.trim();
    const hasJapaneseSetCode = Boolean(
      setCode && new RegExp("(?:^|[^a-z0-9])" + escapeRegex(setCode) + "(?:[^a-z0-9]|$)", "i").test(lower),
    );
    return !hasEnglish && !hasKorean && !hasChinese && (hasJapanese || hasJapaneseSetCode);
  }

  if (identity.language === "zh-cn" || identity.language === "zh-tw") {
    return !hasEnglish && !hasJapanese && !hasKorean && hasChinese;
  }

  return !hasEnglish && !hasJapanese && !hasKorean && !hasChinese;
}

export function matchPriceChartingSaleTitle(
  identity: MarketCardIdentity,
  title: string,
): { matched: boolean; reasons: PriceChartingSaleRejectionReason[] } {
  const titleTokens = new Set(saleTokens(title));
  const nameTokens = saleTokens(identity.englishName || identity.nativeName).filter(
    (token) => !SALE_NAME_STOPWORDS.has(token),
  );
  const reasons: PriceChartingSaleRejectionReason[] = [];

  if (!nameTokens.length || !nameTokens.every((token) => titleTokens.has(token))) {
    reasons.push("identity_name_mismatch");
  }

  const expectedVariants = new Set(nameTokens.filter((token) => SALE_CARD_VARIANTS.has(token)));
  const conflictingVariant = [...SALE_CARD_VARIANTS].some(
    (token) => titleTokens.has(token) && !expectedVariants.has(token),
  );
  if (conflictingVariant) {
    reasons.push("identity_variant_mismatch");
  }

  const collectorCandidates = [identity.numberWithTotal, identity.numberBase]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const normalizedTitle = normalizeSaleText(title).toLowerCase();
  const hasCollector = collectorCandidates.some((candidate) =>
    new RegExp("(?:^|[^0-9a-z])0*" + escapeRegex(candidate) + "(?:[^0-9a-z]|$)", "i").test(
      normalizedTitle,
    ),
  );
  if (!hasCollector) {
    reasons.push("identity_collector_mismatch");
  }

  // Product-page rows often omit the set entirely, which is safe because the
  // parent product was already identity-checked. When a marketplace title does
  // explicitly declare a set/series/expansion, reject a contradictory value.
  const explicitSet = normalizedTitle.match(
    /\b(?:set|series|expansion)\s*[:=]\s*([^|,;/]+)/i,
  )?.[1];
  if (explicitSet) {
    const genericSetTokens = new Set(["card", "cards", "japanese", "pokemon", "set", "tcg"]);
    const expectedTokens = new Set(
      identity.querySetNames
        .flatMap(saleTokens)
        .filter((token) => !genericSetTokens.has(token)),
    );
    const declaredTokens = saleTokens(explicitSet).filter(
      (token) => !genericSetTokens.has(token),
    );
    const hasExpectedSetToken = declaredTokens.some((token) => expectedTokens.has(token));

    if (expectedTokens.size > 0 && declaredTokens.length > 0 && !hasExpectedSetToken) {
      reasons.push("identity_set_mismatch");
    }
  }

  if (!saleLanguageMatchesIdentity(identity, title)) {
    reasons.push("identity_language_mismatch");
  }

  const junkReason = classifySoldCompJunk(title, {
    cardName: identity.englishName || identity.nativeName,
    rarity: identity.rarity,
  });
  if (junkReason === "signed_autograph") {
    reasons.push("junk_signed_autograph");
  } else if (junkReason === "metal_jumbo_promo") {
    reasons.push("junk_metal_jumbo_promo");
  } else if (junkReason === "damaged_slab") {
    reasons.push("junk_damaged_slab");
  } else if (junkReason === "bundle_proxy_reprint") {
    reasons.push("junk_bundle_proxy");
  }

  return { matched: reasons.length === 0, reasons };
}

function priceChartingSaleCondition(
  title: string,
): { condition: string; service: GradingService } | null {
  const graded = title.match(
    /\b(PSA|CGC|BGS|BECKETT|SGC|TAG)\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)\b/i,
  );
  if (graded) {
    const rawService = graded[1].toUpperCase();
    const service = (rawService === "BECKETT" ? "BGS" : rawService) as GradingService;
    return { condition: service + " " + graded[2], service };
  }

  if (/\b(?:graded|slab|gem mint|pristine|black label|ace)\b/i.test(title)) {
    return null;
  }

  return { condition: "Ungraded", service: "RAW" };
}

function absoluteSaleUrl(value: string, sourceUrl: string) {
  try {
    return new URL(value.replace(/&amp;/gi, "&").trim(), sourceUrl).toString();
  } catch {
    return "";
  }
}

export function parsePriceChartingPublicPageSalesDetailed(
  text: string,
  sourceUrl: string,
  identity: MarketCardIdentity,
): PriceChartingSaleParseResult {
  const sales = new Map<string, SaleRecord>();
  const rejectedReasonCounts: PriceChartingSaleParseResult["rejectedReasonCounts"] = {};
  let candidateCount = 0;
  const reject = (reason: PriceChartingSaleRejectionReason) => {
    rejectedReasonCounts[reason] = (rejectedReasonCounts[reason] ?? 0) + 1;
  };
  const consider = (candidate: {
    date: string;
    title: string;
    listingUrl: string;
    marketplace: string;
    price: number;
  }) => {
    candidateCount += 1;
    const title = normalizeSaleText(candidate.title);
    const titleMatch = matchPriceChartingSaleTitle(identity, title);
    for (const reason of titleMatch.reasons) {
      reject(reason);
    }
    if (!titleMatch.matched) {
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) {
      reject("invalid_sale_date");
      return;
    }
    if (!(candidate.price > 0) || !Number.isFinite(candidate.price)) {
      reject("invalid_sale_price");
      return;
    }

    const listingUrl = absoluteSaleUrl(candidate.listingUrl, sourceUrl);
    if (!listingUrl) {
      reject("missing_listing_url");
      return;
    }

    const grade = priceChartingSaleCondition(title);
    if (!grade) {
      reject("unsupported_graded_condition");
      return;
    }

    const sale: SaleRecord = {
      date: candidate.date,
      title,
      condition: grade.condition,
      price: Math.round(candidate.price * 100) / 100,
      source: "PriceCharting completed " + candidate.marketplace + " sales",
      listingUrl,
      sourceUrl,
      service: grade.service,
      confidence: "medium",
      confidenceScore: 0.72,
      evidenceType: "sold_comp",
    };
    sales.set(
      [sale.date, sale.title.toLowerCase(), sale.price, sale.condition].join(":"),
      sale,
    );
  };

  const saleHtml = soldListingsSlice(text);
  if (saleHtml.includes("[eBay]") || saleHtml.includes("[TCGPlayer]")) {
    const markdownRowPattern =
      /\|\s*(\d{4}-\d{2}-\d{2})\s*\|[^\n]{0,400}\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\[(eBay|TCGPlayer)\]\s*\|\s*([^|\n]+)\|/gi;
    for (const match of saleHtml.matchAll(markdownRowPattern)) {
      const prices = [...match[5].matchAll(/\$([0-9][0-9,.]*)/g)]
        .map((priceMatch) => Number.parseFloat(priceMatch[1].replace(/,/g, "")))
        .filter((value) => Number.isFinite(value) && value > 0);
      consider({
        date: match[1],
        title: match[2],
        listingUrl: match[3],
        marketplace: match[4],
        price: prices.at(-1) ?? 0,
      });
    }
  }

  for (const rowMatch of saleHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    const date = row.match(
      /<td\b[^>]*class=["'][^"']*\bdate\b[^"']*["'][^>]*>\s*(\d{4}-\d{2}-\d{2})/i,
    )?.[1];
    const titleMatch = row.match(
      /<td\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const priceMatch = row.match(
      /<span\b[^>]*class=["'][^"']*\bjs-price\b[^"']*["'][^>]*>\s*\$([0-9][0-9,.]*)/i,
    );
    const marketplace = /\btcgplayer\b/i.test(row) ? "TCGPlayer" : /\bebay\b/i.test(row) ? "eBay" : "";
    if (!date || !titleMatch || !priceMatch || !marketplace) {
      continue;
    }
    consider({
      date,
      title: titleMatch[2],
      listingUrl: titleMatch[1],
      marketplace,
      price: Number.parseFloat(priceMatch[1].replace(/,/g, "")),
    });
  }

  return {
    sales: [...sales.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 48),
    candidateCount,
    rejectedReasonCounts,
  };
}

export function parsePriceChartingPublicPageSales(
  text: string,
  sourceUrl: string,
  identity: MarketCardIdentity,
): SaleRecord[] {
  return parsePriceChartingPublicPageSalesDetailed(text, sourceUrl, identity).sales;
}

export function isPriceChartingSearchResultsHtml(html: string) {
  return /your search for [\s\S]{0,160}?found \d+ items/i.test(html);
}

async function fetchPriceChartingPublicPage(
  identity: MarketCardIdentity,
  signal?: AbortSignal,
): Promise<PublicPageCacheValue | null> {
  const urls = publicPageUrlCandidates(identity).slice(0, 1);
  if (!urls.length) {
    return null;
  }

  for (const url of urls) {
    if (signal?.aborted) {
      return null;
    }
    const cacheKey = `exact-sales-v5-fast-parse|${identity.key}|${url}`;
    const cached = await readMarketFileCache<PublicPageCacheValue>(
      "pricecharting-public",
      cacheKey,
      PRICECHARTING_PUBLIC_CACHE_TTL_MS,
    );

    if (cached) {
      return {
        ...cached,
        recentSales: filterJunkSoldComps(cached.recentSales ?? [], {
          cardName: identity.englishName || identity.nativeName,
          rarity: identity.rarity,
        }),
      };
    }

    try {
      const html = await fetchPublicPageText(url, 43_200, {
        readerFirst: false,
        preferHtml: true,
        priority: true,
        signal,
      });

      if (isPriceChartingSearchResultsHtml(html)) {
        continue;
      }

      if (!publicPageMatchesIdentity(identity, html)) {
        continue;
      }

      const gradedPrices = parsePublicPrices(html, url);
      const recentSales = parsePriceChartingPublicPageSales(html, url, identity);
      const embeddedPopulation = parsePriceChartingEmbeddedPopulation(html, url);
      const populations = {
        PSA:
          embeddedPopulation ??
          parsePublicPopulationForService(html, "PSA", url) ??
          undefined,
        CGC: embeddedPopulation
          ? undefined
          : parsePublicPopulationForService(html, "CGC", url) ?? undefined,
        BGS: embeddedPopulation
          ? undefined
          : parsePublicPopulationForService(html, "BGS", url) ?? undefined,
      };
      const hasGuidePrice = gradedPrices.some(
        (price) => price.grade === "Ungraded" && price.value > 0,
      );
      const hasPopulation = Boolean(embeddedPopulation) || Object.values(populations).some(Boolean);
      if (!hasGuidePrice && !recentSales.length && !hasPopulation) {
        continue;
      }

      const value: PublicPageCacheValue = {
        url,
        fetchedAt: nowIso(),
        gradedPrices,
        recentSales,
        populations,
        population: embeddedPopulation,
      };

      await writeMarketFileCache("pricecharting-public", cacheKey, value);
      return value;
    } catch (error) {
      if (isPublicPageTransportBanError(error)) {
        break;
      }
    }
  }

  return null;
}

function firstMatchingProduct(
  identity: MarketCardIdentity,
  products: PriceChartingProduct[] | undefined,
) {
  return (products ?? []).find((product) => priceChartingProductMatchesIdentity(identity, product));
}

export function parsePriceChartingPublicPagePrices(html: string, sourceUrl: string): GradedPrice[] {
  return parsePublicPrices(html, sourceUrl);
}

export async function fetchPriceChartingProduct(
  input: MarketCardIdentityInput,
  signal?: AbortSignal,
): Promise<PriceChartingProductResult | null> {
  if (!isPriceChartingApiConfigured()) {
    return null;
  }

  const identity = buildMarketCardIdentity(input);

  if (identity.productId) {
    try {
      const exactProduct = await fetchPriceChartingJson<PriceChartingProduct>(
        apiProductUrl(identity.productId, ""),
        signal,
        { skipThrottle: true },
      );
      if (
        exactProduct &&
        exactProduct.status !== "error" &&
        priceChartingProductMatchesIdentity(identity, exactProduct)
      ) {
        const productId = cleanProductId(exactProduct.id) ?? identity.productId;
        return {
          identity,
          product: exactProduct,
          query: `id:${productId}`,
          productId,
          productUrl: identity.productUrl ?? publicPageUrl(identity) ?? undefined,
          setSlug: identity.setSlug,
        };
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      // Fall through to verified fuzzy search if the stored id is stale/unavailable.
    }
  }

  for (const query of identity.priceChartingQueries.slice(0, 1)) {
    const search = await fetchPriceChartingJson<PriceChartingProductsResponse>(
      productsUrl(query),
      signal,
      { skipThrottle: true },
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
        ? await fetchPriceChartingJson<PriceChartingProduct>(apiProductUrl(match.id, query), signal, {
            skipThrottle: true,
          })
        : await fetchPriceChartingJson<PriceChartingProduct>(
            apiProductUrl(undefined, query),
            signal,
            { skipThrottle: true },
          );

    const product = full?.status === "error" || !full ? match : full;
    if (!priceChartingProductMatchesIdentity(identity, product)) {
      continue;
    }

    return {
      identity,
      product,
      query,
      productId: cleanProductId(product.id) ?? cleanProductId(match.id),
      productUrl: identity.productUrl ?? publicPageUrl(identity) ?? undefined,
      setSlug: identity.setSlug ?? setSlugFromProductUrl(identity.productUrl),
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
      const unavailable =
        error instanceof MarketHttpError &&
        (error.code === "blocked" ||
          error.code === "rate_limited" ||
          error.code === "circuit_open" ||
          error.code === "timeout" ||
          error.code === "network_error");
      return {
        population: null,
        sourceStatus: sourceStatus({
          source: "PriceCharting public page",
          state: unavailable ? "failed" : "no_match",
          confidenceScore: 0.18,
          note: unavailable
            ? "PriceCharting public population data is temporarily unavailable; cached or alternate evidence remains eligible."
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
  const identity = buildMarketCardIdentity(input);

  const fromPublicPage = async (pageIdentity: MarketCardIdentity = identity) => {
    const publicPage = await fetchPriceChartingPublicPage(pageIdentity, signal).catch(() => null);
    const ungraded = publicPage?.gradedPrices.find((price) => price.grade === "Ungraded");

    if (
      publicPage &&
      (ungraded?.value ||
        (publicPage.recentSales?.length ?? 0) > 0 ||
        Object.values(publicPage.populations).some(Boolean) ||
        hasPricedMarketPayload({
          ungradedUsd: ungraded?.value ?? 0,
          gradedPrices: publicPage.gradedPrices,
        }))
    ) {
      const sales = publicPage.recentSales ?? [];
      return {
        result: null,
        ungradedUsd: ungraded?.value ?? 0,
        gradedPrices: publicPage.gradedPrices,
        sales,
        population: publicPage.population ?? publicPage.populations.PSA ?? null,
        sourceUrl: publicPage.url,
        productId: pageIdentity.productId,
        productUrl: publicPage.url,
        setSlug: setSlugFromProductUrl(publicPage.url) ?? pageIdentity.setSlug,
        sourceLabel: "PriceCharting public page",
        evidenceType: "guide_snapshot" as const,
        confidenceScore: 0.58,
        matchConfidence: 0.9,
        sampleCount: sales.length || 1,
      };
    }

    return null;
  };

  const fromApiProduct = async () => {
    if (!isPriceChartingApiConfigured()) {
      return null;
    }

    const result = await fetchPriceChartingProduct(input, signal).catch(() => null);
    if (!result) {
      return null;
    }

    const productSourceUrl = sourceUrl(result.product);
    const gradedPrices = parsePriceChartingGradedPrices(result.product, productSourceUrl);
    const ungraded = gradedPrices.find((price) => price.grade === "Ungraded");
    const apiPopulation = parsePriceChartingPopulation(result.product, "PSA", productSourceUrl);

    return {
      result,
      ungradedUsd: ungraded?.value ?? 0,
      gradedPrices,
      sales: [] as SaleRecord[],
      population: apiPopulation,
      sourceUrl: productSourceUrl,
      productId: result.productId,
      productUrl: result.productUrl ?? identity.productUrl,
      setSlug: result.setSlug ?? identity.setSlug,
      sourceLabel: "PriceCharting API",
      evidenceType: "guide_snapshot" as const,
      confidenceScore: 0.62,
      matchConfidence: 0.9,
      sampleCount: 1,
    };
  };

  const mergeApiWithPublicPage = (
    apiResult: NonNullable<Awaited<ReturnType<typeof fromApiProduct>>>,
    publicPage: Awaited<ReturnType<typeof fromPublicPage>>,
  ) => {
    const publicPop = publicPage?.population;
    const mergedGrades = new Map(
      apiResult.gradedPrices.filter((price) => price.value > 0).map((price) => [price.grade, price]),
    );
    for (const price of publicPage?.gradedPrices ?? []) {
      if (price.value > 0) {
        mergedGrades.set(price.grade, price);
      }
    }

    return {
      ...apiResult,
      gradedPrices: [...mergedGrades.values()],
      ungradedUsd:
        (mergedGrades.get("Ungraded")?.value ?? 0) ||
        apiResult.ungradedUsd ||
        publicPage?.ungradedUsd ||
        0,
      sales: publicPage?.sales?.length ? publicPage.sales : apiResult.sales,
      population: publicPop ?? apiResult.population,
      productUrl: publicPage?.productUrl ?? apiResult.productUrl,
      setSlug: publicPage?.setSlug ?? apiResult.setSlug,
      sampleCount: publicPage?.sales?.length || apiResult.sampleCount,
      sourceLabel: publicPage?.sales?.length
        ? "PriceCharting API + public page"
        : apiResult.sourceLabel,
    };
  };

  // Public HTML is often Cloudflare-slow from this app's IP. Take the JSON API
  // as soon as it has slabs/pop, and only wait briefly for the HTML sales grid.
  // Cap the API wait: three 10s product searches were blowing the 18s core budget
  // and the route returned a blank timeout with nothing to show.
  const publicPromise = fromPublicPage();
  const apiHit = await Promise.race([
    fromApiProduct().catch(() => null),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 4_000);
    }),
  ]);

  if (apiHit && (hasPricedMarketPayload(apiHit) || apiHit.population || apiHit.gradedPrices.length)) {
    const publicIdentityHit = await Promise.race([
      publicPromise,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 1_200);
      }),
    ]).catch(() => null);

    if (publicIdentityHit) {
      return mergeApiWithPublicPage(apiHit, publicIdentityHit);
    }

    return apiHit;
  }

  const publicIdentityHit = await publicPromise.catch(() => null);

  if (publicIdentityHit && hasPricedMarketPayload(publicIdentityHit)) {
    return publicIdentityHit;
  }

  // Catalog fallback is already applied from the card's raw market price.
  // The open-source hop after a slow HTML miss was blowing the core budget.
  return publicIdentityHit;
}
