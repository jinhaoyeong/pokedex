import { latestCardTimestamp } from "@/lib/card-catalog-facts";
import type { CardSourceNote, MarketConfidence, TcgCard } from "@/types/pokemon";

export const CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export type FieldTrustStatus = "verified" | "estimated" | "stale" | "disputed";

export function confidenceFromScore(score: number): MarketConfidence {
  if (score >= 0.75) {
    return "high";
  }

  if (score >= 0.45) {
    return "medium";
  }

  return "low";
}

export function isCacheStale(lastUpdatedAt: string | null | undefined, now = Date.now()) {
  if (!lastUpdatedAt) {
    return true;
  }

  const updatedAt = Date.parse(lastUpdatedAt);

  if (!Number.isFinite(updatedAt)) {
    return true;
  }

  return now - updatedAt > CACHE_STALE_MS;
}

export function deriveIdentityStatus(card: TcgCard): FieldTrustStatus {
  const officialSource = card.sources.some(
    (source) =>
      source.status === "verified" &&
      /official|tcgdex|pokemontcg|pokemon tcg/i.test(source.source),
  );
  const hasCatalogFacts = Boolean(card.types?.length) && Boolean(card.hp && card.hp !== "-");

  if (officialSource && (card.imageStatus === "official" || hasCatalogFacts)) {
    return "verified";
  }

  if (card.id.startsWith("market-fallback-") || card.imageStatus === "placeholder") {
    return "estimated";
  }

  return "estimated";
}

export function derivePriceStatus(
  card: TcgCard,
  lastEnrichedAt?: string | null,
  disputed = false,
): FieldTrustStatus {
  if (disputed) {
    return "disputed";
  }

  const enrichedAt = lastEnrichedAt ?? latestCardTimestamp(card);
  if (enrichedAt && isCacheStale(enrichedAt)) {
    return "stale";
  }

  const consensus = card.priceConsensus;
  const hasSoldEvidence = Boolean(
    card.recentSales.length ||
      card.marketEvidence?.some((item) => item.evidenceType === "sold_comp"),
  );

  if (consensus && consensus.confidenceScore >= 0.72 && hasSoldEvidence) {
    return "verified";
  }

  if (consensus && consensus.confidenceScore >= 0.5) {
    return "estimated";
  }

  if (card.marketPriceUsd > 0) {
    return "estimated";
  }

  return "stale";
}

export function computeTrustScore(input: {
  searchHits: number;
  detailViews: number;
  wrongPriceFlags: number;
  wrongCardFlags: number;
  identityStatus: FieldTrustStatus;
  priceStatus: FieldTrustStatus;
}) {
  let score = 0.42;

  score += Math.min(0.22, input.searchHits * 0.015);
  score += Math.min(0.12, input.detailViews * 0.02);
  score -= Math.min(0.35, input.wrongPriceFlags * 0.08);
  score -= Math.min(0.5, input.wrongCardFlags * 0.2);

  if (input.identityStatus === "verified") {
    score += 0.12;
  }

  if (input.priceStatus === "verified") {
    score += 0.14;
  } else if (input.priceStatus === "stale") {
    score -= 0.08;
  } else if (input.priceStatus === "disputed") {
    score -= 0.2;
  }

  return Math.max(0.05, Math.min(0.98, score));
}

export function statusLabel(status: FieldTrustStatus) {
  switch (status) {
    case "verified":
      return "Verified";
    case "estimated":
      return "Estimated";
    case "stale":
      return "Stale";
    case "disputed":
      return "Needs review";
  }
}

export function statusClassName(status: FieldTrustStatus) {
  switch (status) {
    case "verified":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
    case "estimated":
      return "border-blue-400/30 bg-blue-400/10 text-blue-100";
    case "stale":
      return "border-amber-400/30 bg-amber-400/10 text-amber-100";
    case "disputed":
      return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }
}

export function appendLearningSource(
  sources: CardSourceNote[],
  note: string,
  status: FieldTrustStatus,
  confidence: number,
): CardSourceNote[] {
  return [
    ...sources.filter((source) => source.source !== "Community learning cache"),
    {
      source: "Community learning cache",
      status: status === "verified" ? "verified" : status === "stale" ? "stale" : "estimated",
      fetchedAt: new Date().toISOString(),
      confidence,
      note,
    },
  ];
}
