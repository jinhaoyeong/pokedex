import type { MarketConfidence, TcgCard } from "@/types/pokemon";

export type PriceDisplayMeta = {
  label: string;
  confidence: MarketConfidence;
  confidenceScore: number;
  isEstimate: boolean;
  isEnglishCompanion: boolean;
  lastSoldAt?: string | null;
  lastSoldPriceUsd?: number | null;
};

export function getPriceDisplayMeta(card: TcgCard): PriceDisplayMeta {
  const consensus = card.priceConsensus;
  const soldSource = consensus?.sources?.find((source) => source.evidenceType === "sold_comp");
  const catalogSource = consensus?.sources?.find((source) => source.evidenceType === "catalog");
  const isEnglishCompanion =
    Boolean(catalogSource?.note?.toLowerCase().includes("english companion")) ||
    Boolean(consensus?.methodology?.toLowerCase().includes("english print")) ||
    (card.sources ?? []).some((source) =>
      source.note?.toLowerCase().includes("english companion"),
    );
  const soldGrade = (card.gradedPrices ?? []).find((price) => price.grade === "Ungraded");
  const lastSoldAt = soldGrade?.lastSoldAt ?? card.recentSales?.[0]?.date ?? null;
  const lastSoldPriceUsd = card.recentSales?.[0]?.price ?? soldGrade?.value ?? null;

  if (soldSource && card.marketPriceUsd > 0) {
    return {
      label: "Sold comp",
      confidence: soldSource.confidence,
      confidenceScore: soldSource.confidenceScore,
      isEstimate: false,
      isEnglishCompanion: false,
      lastSoldAt,
      lastSoldPriceUsd,
    };
  }

  if (card.marketPriceUsd > 0 && !isEnglishCompanion) {
    return {
      label: "Catalog",
      confidence: consensus?.confidence ?? "medium",
      confidenceScore: consensus?.confidenceScore ?? 0.58,
      isEstimate: false,
      isEnglishCompanion: false,
      lastSoldAt,
      lastSoldPriceUsd,
    };
  }

  if (card.marketPriceUsd > 0 && isEnglishCompanion) {
    return {
      label: "English print est.",
      confidence: "low",
      confidenceScore: 0.38,
      isEstimate: true,
      isEnglishCompanion: true,
      lastSoldAt,
      lastSoldPriceUsd,
    };
  }

  if (card.marketPriceUsd > 0) {
    return {
      label: "Estimate",
      confidence: consensus?.confidence ?? "low",
      confidenceScore: consensus?.confidenceScore ?? 0.35,
      isEstimate: true,
      isEnglishCompanion: false,
      lastSoldAt,
      lastSoldPriceUsd,
    };
  }

  return {
    label: "Pending",
    confidence: "low",
    confidenceScore: 0.15,
    isEstimate: true,
    isEnglishCompanion: false,
    lastSoldAt,
    lastSoldPriceUsd,
  };
}
