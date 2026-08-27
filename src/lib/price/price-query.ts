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

/** Providers whose exact-card price may replace a low-confidence server estimate. */
export const VERIFIED_PRICE_PROVIDERS = new Set([
  "pricecharting-api",
  "collectr-fallback",
  "ebay",
  "tcgdex",
  "tcgdex-open",
]);

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

export function isVerifiedPriceResult(data: PriceLookupPayload | null | undefined): boolean {
  const priceUsd = getPriceLookupUsd(data);

  return Boolean(
    data &&
      priceUsd &&
      data.primaryProvider &&
      VERIFIED_PRICE_PROVIDERS.has(data.primaryProvider),
  );
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
 * headline. Estimates must not stamp ESTIMATED over a price we already have,
 * and a much lower "verified" hit is treated as a wrong-card match.
 */
export function resolveLazyListPrice(input: {
  incomingUsd: number | null;
  initialUsd: number;
  verified: boolean;
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

  if (input.initialUsd > 0 && incomingUsd < input.initialUsd * 0.5) {
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
