import {
  resolveGradingMarketLookupCardName,
  resolveGradingMarketLookupSetName,
} from "@/lib/grading-market-lookup";
import type { TcgCard } from "@/types/pokemon";

export function buildGradingMarketParams(card: TcgCard, mode?: "core" | "full") {
  const lookupSetName = resolveGradingMarketLookupSetName(card);
  const lookupCardName = resolveGradingMarketLookupCardName(card);
  const params = new URLSearchParams({
    setName: lookupSetName,
    cardName: lookupCardName,
    cardNumber: card.collectorNumber,
    rawMarketPriceUsd: String(card.marketPriceUsd),
  });
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
  if (mode === "core") {
    params.set("mode", "core");
  }

  return params;
}
