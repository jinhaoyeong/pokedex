import type { TcgCard } from "@/types/pokemon";

/**
 * Client-safe helpers for the block-resistant `/api/price` lookup. (No server-only
 * imports — usable from the list and detail hooks.)
 */

/** Providers whose price is a real guide/sold figure that may replace a server estimate. */
export const VERIFIED_PRICE_PROVIDERS = new Set(["pricecharting-api", "ebay"]);

export type PriceLookupPayload = {
  ungradedUsd?: number;
  primaryProvider?: string;
};

export function isVerifiedPriceResult(data: PriceLookupPayload | null | undefined): boolean {
  return Boolean(
    data &&
      typeof data.ungradedUsd === "number" &&
      data.ungradedUsd > 0 &&
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
