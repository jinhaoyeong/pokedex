import { catalogMarketName } from "@/lib/card-catalog-facts";
import type {
  GradedPrice,
  JapaneseMarketIdentity,
  SaleRecord,
  TcgCard,
} from "@/types/pokemon";

/**
 * Client-safe helpers for the block-resistant `/api/price` lookup. (No server-only
 * imports — usable from the list and detail hooks.)
 */

/** Independent market references that may verify a list/detail headline. */
export const VERIFIED_PRICE_PROVIDERS = new Set([
  "pricecharting-api",
  "collectr-fallback",
  "ebay",
]);

/** TCGPlayer via Pokemon TCG API — real listings, used only when no guide/sold reference answers. */
const TRUSTED_TCGPLAYER_PROVIDERS = new Set(["pokemontcg"]);

export type PriceLookupProviderResult = {
  provider?: string;
  sourceLabel?: string;
  ungradedUsd?: number | null;
  confidenceScore?: number;
  matchConfidence?: number;
  evidenceType?: "guide_snapshot" | "sold_comp" | "catalog";
  gradedPrices?: GradedPrice[];
  sales?: SaleRecord[];
  sampleCount?: number;
  fetchedAt?: string;
  sourceUrl?: string;
};

export type PriceLookupPayload = {
  status?:
    | "success"
    | "partial"
    | "no_match"
    | "identity_incomplete"
    | "timeout"
    | "circuit_open"
    | "provider_error";
  identityStatus?: JapaneseMarketIdentity["identityStatus"] | null;
  marketIdentity?: JapaneseMarketIdentity | null;
  ungradedUsd?: number | null;
  marketPrice?: number | null;
  psa10?: number | null;
  nmMarketUsd?: number | null;
  prices?: {
    market?: number | null;
    ungraded?: number | null;
    raw?: number | null;
    psa10?: number | null;
    nm?: number | null;
  };
  primaryProvider?: string;
  confidenceScore?: number;
  fetchedAt?: string;
  results?: PriceLookupProviderResult[];
};

function positivePrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function getPriceLookupUsd(data: PriceLookupPayload | null | undefined): number | null {
  if (!data) {
    return null;
  }

  return (
    positivePrice(data.ungradedUsd) ??
    positivePrice(data.marketPrice) ??
    positivePrice(data.prices?.market) ??
    positivePrice(data.prices?.ungraded) ??
    positivePrice(data.prices?.raw)
  );
}

function medianUsd(values: number[]) {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);

  if (!sorted.length) {
    return null;
  }

  return sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]
    : Math.round(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) * 100) / 100;
}

function clusteredMedianUsd(values: number[]) {
  const median = medianUsd(values);
  if (median == null) {
    return null;
  }

  const clustered = values.filter((value) => value >= median * 0.45 && value <= median * 2.2);
  return medianUsd(clustered.length ? clustered : values);
}

function isCatalogOnlyTcgdexResult(result: PriceLookupProviderResult) {
  return /^(tcgdex|tcgdex-open)$/i.test(result.provider ?? "") || /tcgdex/i.test(result.sourceLabel ?? "");
}

function isTrustedMarketReferenceHit(result: PriceLookupProviderResult) {
  const usd = positivePrice(result.ungradedUsd);
  if (!usd) {
    return false;
  }

  if (isCatalogOnlyTcgdexResult(result) || result.evidenceType === "catalog") {
    return false;
  }

  const matchConfidence = result.matchConfidence ?? 1;
  if (matchConfidence < 0.7) {
    return false;
  }

  const provider = result.provider ?? "";
  const label = result.sourceLabel ?? "";

  if (provider === "pricecharting-api" || /pricecharting/i.test(label)) {
    return true;
  }

  if (provider === "collectr-fallback" || /collectr/i.test(label)) {
    return true;
  }

  return (/^ebay/i.test(provider) || /ebay/i.test(label)) && result.evidenceType === "sold_comp";
}

function isTrustedTcgplayerHit(result: PriceLookupProviderResult) {
  const usd = positivePrice(result.ungradedUsd);
  if (!usd || isCatalogOnlyTcgdexResult(result)) {
    return false;
  }

  const provider = result.provider ?? "";
  if (!TRUSTED_TCGPLAYER_PROVIDERS.has(provider) && !/^pokemon\s*tcg/i.test(result.sourceLabel ?? "")) {
    return false;
  }

  return (result.matchConfidence ?? 1) >= 0.85 && (result.confidenceScore ?? 0) >= 0.6;
}

/**
 * Best trustable raw USD from `/api/price`. Prefers PriceCharting / Collectr /
 * eBay sold comps (median when several agree). TCGPlayer catalog is a fallback
 * only when those references are missing. TCGdex catalog is never trusted.
 */
export function pickTrustedMarketUsd(data: PriceLookupPayload | null | undefined): number | null {
  if (!data) {
    return null;
  }

  const results = data.results ?? [];
  const referenceUsd = clusteredMedianUsd(
    results.filter(isTrustedMarketReferenceHit).map((result) => result.ungradedUsd ?? 0),
  );

  if (referenceUsd) {
    return referenceUsd;
  }

  const tcgplayerUsd = clusteredMedianUsd(
    results.filter(isTrustedTcgplayerHit).map((result) => result.ungradedUsd ?? 0),
  );

  if (tcgplayerUsd) {
    return tcgplayerUsd;
  }

  const primary = data.primaryProvider ?? "";
  if (VERIFIED_PRICE_PROVIDERS.has(primary) && !/^(tcgdex|tcgdex-open)$/i.test(primary)) {
    const primaryResult = results.find((result) => result.provider === primary);
    if (primaryResult && isCatalogOnlyTcgdexResult(primaryResult)) {
      return null;
    }

    if (primary === "ebay") {
      if (primaryResult?.evidenceType !== "sold_comp") {
        return null;
      }
    }

    return getPriceLookupUsd(data);
  }

  return null;
}

export function isVerifiedPriceResult(data: PriceLookupPayload | null | undefined): boolean {
  return pickTrustedMarketUsd(data) != null;
}

export function isTrustedMarketReferenceResult(data: PriceLookupPayload | null | undefined): boolean {
  return pickTrustedMarketUsd(data) != null;
}

const LANGUAGE_OR_REGION_TAG =
  /^(?:en|eng|english|jp|ja|japanese|ko|kr|korean|cn|zh|tw|chinese|fr|de|es|it|pt|br|nl|pl|ru|id|th)$/i;

/** Pull an English market name from `ディアルガ (Dialga)`, but ignore `Dialga (JP)`. */
export function extractParentheticalEnglish(value?: string | null) {
  const match = value?.match(/\(([^()]*[A-Za-z][^()]*)\)\s*$/);
  const inner = match?.[1]?.trim();

  if (!inner || LANGUAGE_OR_REGION_TAG.test(inner)) {
    return undefined;
  }

  return inner;
}

/**
 * Decide whether a lazy `/api/price` hit should replace the tile's current
 * headline. Estimates must not stamp ESTIMATED over a price we already have.
 * Untrusted showcase/grail numbers may be replaced by a trusted reference even
 * when the live raw is much lower. Trusted headlines keep a 50% wrong-card floor.
 */
export function resolveLazyListPrice(input: {
  incomingUsd: number | null;
  initialUsd: number;
  verified: boolean;
  initialIsUntrusted?: boolean;
}): { priceUsd: number; isEstimate: boolean } | null {
  const incomingUsd = input.incomingUsd;

  if (!(typeof incomingUsd === "number" && incomingUsd > 0)) {
    return null;
  }

  if (!input.verified) {
    if (input.initialUsd > 0) {
      return null;
    }

    return { priceUsd: incomingUsd, isEstimate: true };
  }

  if (
    !input.initialIsUntrusted &&
    input.initialUsd > 0 &&
    incomingUsd < input.initialUsd * 0.5
  ) {
    return null;
  }

  return { priceUsd: incomingUsd, isEstimate: false };
}

export function isEstimatedPriceResult(data: PriceLookupPayload | null | undefined): boolean {
  const primaryProvider = data?.primaryProvider;
  const primaryResult =
    data?.results?.find((result) => result.provider === primaryProvider) ??
    data?.results?.find((result) => result.ungradedUsd && result.ungradedUsd > 0);

  return Boolean(
    data &&
      getPriceLookupUsd(data) &&
      ((primaryResult?.evidenceType === "catalog" &&
        /^(tcgdex|tcgdex-open|pokemontcg-open|pokemontcg)$/i.test(primaryProvider ?? "")) ||
        (data.confidenceScore ?? primaryResult?.confidenceScore ?? 1) < 0.5),
  );
}

export function buildPriceLookupParams(
  card: Pick<
    TcgCard,
    | "slug"
    | "name"
    | "language"
    | "id"
    | "officialCardId"
    | "browseIndex"
    | "marketIdentity"
    | "setCode"
    | "setName"
    | "setEnglishName"
    | "collectorNumber"
    | "englishName"
    | "rarity"
    | "finish"
  >,
): URLSearchParams {
  const params = new URLSearchParams();
  const lookupName = catalogMarketName(card);
  const englishName =
    card.englishName?.trim() ||
    (card.language === "en" ? lookupName : extractParentheticalEnglish(card.name)) ||
    "";
  params.set("slug", card.slug);
  params.set("name", card.language === "en" ? lookupName || card.name : card.name);
  params.set("language", card.language);
  if (card.id) params.set("cardId", card.id);
  if (card.officialCardId) params.set("officialCardId", card.officialCardId);
  if (typeof card.browseIndex === "number") params.set("browseIndex", String(card.browseIndex));
  if (card.setCode) params.set("setCode", card.setCode);
  if (card.setName) params.set("setName", card.setName);
  if (card.setEnglishName) params.set("setEnglishName", card.setEnglishName);
  if (card.collectorNumber) params.set("number", card.collectorNumber);
  if (englishName) params.set("englishName", englishName);
  if (card.rarity) params.set("rarity", card.rarity);
  if (card.finish) params.set("finish", card.finish);
  if (card.marketIdentity?.priceChartingProductId) {
    params.set("priceChartingProductId", card.marketIdentity.priceChartingProductId);
  }
  if (card.marketIdentity?.priceChartingProductUrl) {
    params.set("priceChartingProductUrl", card.marketIdentity.priceChartingProductUrl);
  }
  if (card.marketIdentity?.priceChartingSetSlug) {
    params.set("priceChartingSetSlug", card.marketIdentity.priceChartingSetSlug);
  }
  if (card.marketIdentity?.identityVersion) {
    params.set("identityVersion", String(card.marketIdentity.identityVersion));
  }
  return params;
}
