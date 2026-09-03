import {
  resolveGradingMarketLookupCardName,
  resolveGradingMarketLookupSetName,
} from "@/lib/grading-market-lookup";
import { extractTrustedCatalogRawPrices } from "@/lib/market/slab-estimate-v1";
import type { TcgCard } from "@/types/pokemon";

/** Identity-only key so catalog/price hydration does not restart live market fetches. */
export function cardMarketEnrichmentKey(
  card: Pick<TcgCard, "slug" | "finish" | "language" | "setCode" | "collectorNumber">,
) {
  return [
    card.slug,
    card.finish ?? "",
    card.language ?? "en",
    card.setCode ?? "",
    card.collectorNumber ?? "",
  ].join("|");
}

export function buildGradingMarketParams(card: TcgCard, mode?: "core" | "full") {
  const lookupSetName = resolveGradingMarketLookupSetName(card);
  const lookupCardName = resolveGradingMarketLookupCardName(card);
  const params = new URLSearchParams({
    setName: lookupSetName,
    cardName: lookupCardName,
    cardNumber: card.collectorNumber,
    rawMarketPriceUsd: String(card.marketPriceUsd),
  });
  if (card.id) {
    params.set("cardId", card.id);
  }
  if (card.slug) {
    params.set("slug", card.slug);
  }
  const setTotal = card.setPrintedTotal ?? card.setTotal;

  if (typeof setTotal === "number" && setTotal > 0) {
    params.set("setTotal", String(setTotal));
  }
  if (card.rarity && card.rarity !== "Unknown") {
    params.set("rarity", card.rarity);
  }
  if (card.setCode) {
    params.set("setCode", card.setCode);
  }
  if (card.setEnglishName) {
    params.set("setEnglishName", card.setEnglishName);
  }
  if (card.setLocalizedName) {
    params.set("japaneseSetName", card.setLocalizedName);
  }
  if (card.language) {
    params.set("language", card.language);
  }
  if (card.officialCardId) {
    params.set("officialCardId", card.officialCardId);
  }
  if (typeof card.browseIndex === "number") {
    params.set("browseIndex", String(card.browseIndex));
  }
  if (card.englishName?.trim()) {
    params.set("englishCardName", card.englishName.trim());
  }
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
  if (card.finish) {
    params.set("finish", card.finish);
  }
  const trustedRaw = extractTrustedCatalogRawPrices(card);
  if (trustedRaw[0]) {
    params.set("trustedRawUsd", String(trustedRaw[0]));
  }
  if (card.setReleaseDate) {
    params.set("setReleaseDate", card.setReleaseDate);
  }
  if (card.marketIdentity?.printedCollectorNumber) {
    params.set("printedCollectorNumber", card.marketIdentity.printedCollectorNumber);
  }
  if (mode === "core") {
    params.set("mode", "core");
  }

  return params;
}

/**
 * Params for `/api/grading-population`, which is a census lookup and nothing
 * else — no price context, no sold comps.
 *
 * Deliberately NOT buildGradingMarketParams: that carries a raw market price
 * and trusted catalog prices, and the population route memoises on its whole
 * sorted query string, so every price move would miss a cache that is meant to
 * be shared by every viewer of the card. What is here is what the route reads,
 * plus the four identity fields (official id, PriceCharting product, finish,
 * identity version) that buildPopulationKey hashes — send those and a census
 * the route stores lands on the key the card-detail first paint reads back.
 */
export function buildGradingPopulationParams(card: TcgCard) {
  const params = new URLSearchParams({
    cardName: resolveGradingMarketLookupCardName(card),
    cardNumber: card.collectorNumber,
    setName: resolveGradingMarketLookupSetName(card),
  });

  const optional: Array<[string, string | number | undefined | null]> = [
    ["englishName", card.englishName?.trim()],
    ["setEnglishName", card.setEnglishName],
    ["setCode", card.setCode],
    ["language", card.language],
    ["rarity", card.rarity && card.rarity !== "Unknown" ? card.rarity : undefined],
    ["setPrintedTotal", card.setPrintedTotal],
    ["setTotal", card.setTotal],
    ["officialCardId", card.officialCardId],
    ["priceChartingProductId", card.marketIdentity?.priceChartingProductId],
    ["identityVersion", card.marketIdentity?.identityVersion],
    ["finish", card.finish],
  ];

  for (const [key, value] of optional) {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value));
    }
  }

  return params;
}
