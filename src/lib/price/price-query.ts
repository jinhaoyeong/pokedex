import type { TcgCard } from "@/types/pokemon";

/**
 * Client-safe helpers for the block-resistant `/api/price` lookup. (No server-only
 * imports — usable from the list and detail hooks.)
 */

/** Providers whose exact-card price may replace a low-confidence server estimate. */
export const VERIFIED_PRICE_PROVIDERS = new Set([
  "pricecharting-api",
  "ebay",
  "tcgdex",
  "tcgdex-open",
]);

export type PriceLookupPayload = {
  ungradedUsd?: number | null;
  marketPrice?: number | null;
  psa10?: number | null;
  prices?: {
    market?: number | null;
    ungraded?: number | null;
    raw?: number | null;
    psa10?: number | null;
  };
  primaryProvider?: string;
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

export function buildPriceLookupParams(
  card: Pick<
    TcgCard,
    | "slug"
    | "name"
    | "language"
    | "id"
    | "setCode"
    | "setName"
    | "setEnglishName"
    | "collectorNumber"
    | "englishName"
    | "rarity"
  >,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("slug", card.slug);
  params.set("name", card.name);
  params.set("language", card.language);
  if (card.id) params.set("cardId", card.id);
  if (card.setCode) params.set("setCode", card.setCode);
  if (card.setName) params.set("setName", card.setName);
  if (card.setEnglishName) params.set("setEnglishName", card.setEnglishName);
  if (card.collectorNumber) params.set("number", card.collectorNumber);
  if (card.englishName) params.set("englishName", card.englishName);
  if (card.rarity) params.set("rarity", card.rarity);
  return params;
}
