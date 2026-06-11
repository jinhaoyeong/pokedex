import type { TcgCard } from "@/types/pokemon";

export function buildGradingMarketParams(card: TcgCard, mode?: "core" | "full") {
  const lookupSetName = card.setEnglishName?.trim() || card.setName;
  const lookupCardName =
    card.language !== "en" && card.englishName?.trim()
      ? card.englishName.trim()
      : card.name;
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
  if (card.language) {
    params.set("language", card.language);
  }
  if (card.englishName?.trim()) {
    params.set("englishCardName", card.englishName.trim());
  }
  if (mode === "core") {
    params.set("mode", "core");
  }

  return params;
}
