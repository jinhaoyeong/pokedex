import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { isFirstEditionFinish } from "@/lib/card-finish";
import { cardHasPartialPreviewMarketData } from "@/lib/grading-market-lookup";
import type { TcgCard } from "@/types/pokemon";

const EXPLICIT_ESTIMATE_PATTERN =
  /early market estimate|localized market estimate|rarity estimate|localized search group estimate/i;

const VERIFIED_MARKET_SOURCE_PATTERN =
  /pricecharting|public guide|public sold|magery|grading market consensus/i;

function hasVerifiedMarketSource(card: TcgCard) {
  return Boolean(
    card.priceConsensus?.sources?.some((source) => {
      const score = source.confidenceScore ?? 0;

      return (
        source.evidenceType === "sold_comp" ||
        (source.evidenceType === "guide_snapshot" && score >= 0.5) ||
        VERIFIED_MARKET_SOURCE_PATTERN.test(source.source ?? "")
      );
    }) ||
      card.sources?.some((source) => VERIFIED_MARKET_SOURCE_PATTERN.test(source.source)) ||
      card.gradedPrices?.some(
        (price) =>
          price.grade === "Ungraded" &&
          price.value > 0 &&
          VERIFIED_MARKET_SOURCE_PATTERN.test(price.source ?? ""),
      ),
  );
}

function hasExplicitEstimateSource(card: TcgCard) {
  return Boolean(
    card.sources?.some((source) => EXPLICIT_ESTIMATE_PATTERN.test(source.source)) ||
      card.priceConsensus?.sources?.some((source) =>
        EXPLICIT_ESTIMATE_PATTERN.test(source.source ?? ""),
      ) ||
      card.gradedPrices?.some(
        (price) =>
          price.grade === "Ungraded" && EXPLICIT_ESTIMATE_PATTERN.test(price.source ?? ""),
      ),
  );
}

/**
 * Low-confidence launch/rarity estimates that can be off by an order of
 * magnitude (a few hundred on a few-thousand-dollar chase card). List tiles
 * and price-sort keys must not use these values.
 */
export function isLowConfidenceLocalizedEstimate(card: TcgCard) {
  if (hasVerifiedMarketSource(card)) {
    return false;
  }

  if (hasExplicitEstimateSource(card)) {
    return true;
  }

  if (card.language === "en") {
    return false;
  }

  const consensusSources = card.priceConsensus?.sources ?? [];
  const catalogOnlyPrice =
    getHeadlineMarketPriceUsd(card) > 0 &&
    (!consensusSources.length ||
      consensusSources.every((source) => source.evidenceType === "catalog"));

  return Boolean(
    catalogOnlyPrice ||
      (card.priceConsensus?.confidence === "low" &&
        (card.priceConsensus.confidenceScore ?? 1) < 0.4),
  );
}

export function cardNeedsListPriceLookup(card: TcgCard) {
  const headline = getHeadlineMarketPriceUsd(card);

  if (cardHasPartialPreviewMarketData(card)) {
    return !(headline > 0);
  }

  if (isFirstEditionFinish(card.finish) && !(headline > 0)) {
    return true;
  }

  if (!(headline > 0) || isLowConfidenceLocalizedEstimate(card)) {
    return true;
  }

  return hasExplicitEstimateSource(card);
}

/** Guide/sold headline safe to show and sort on immediately. */
export function trustedListPriceUsd(card: TcgCard) {
  if (isLowConfidenceLocalizedEstimate(card)) {
    return 0;
  }

  const headline = getHeadlineMarketPriceUsd(card);
  return headline > 0 ? headline : 0;
}

/**
 * Figure the Dex tile can paint with the card identity. Catalog TCGPlayer /
 * TCGdex headlines are allowed so the grid does not drip `/api/price` after
 * first paint. Launch/rarity estimates stay hidden.
 */
export function displayableListPriceUsd(card: TcgCard) {
  if (hasExplicitEstimateSource(card) && !hasVerifiedMarketSource(card)) {
    return 0;
  }

  const headline = getHeadlineMarketPriceUsd(card);
  return headline > 0 ? headline : 0;
}
