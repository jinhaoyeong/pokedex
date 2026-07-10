"use client";

import { useEffect, useState } from "react";

import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import {
  buildPriceLookupParams,
  getPriceLookupUsd,
  isEstimatedPriceResult,
  isVerifiedPriceResult,
  type PriceLookupPayload,
} from "@/lib/price/price-query";
import type { TcgCard } from "@/types/pokemon";

// Bounded client-side queue so a 50-card page resolves prices in render order
// (top/visible cards first). Prices come from /api/price — cache-first and
// non-blocking — so the list never triggers a PriceCharting scrape burst.
const MAX_CONCURRENT = 10;
let activeCount = 0;
const pending: Array<() => void> = [];

type LazyPriceState = {
  slug: string;
  priceUsd: number;
  isEstimate: boolean;
  isLoading: boolean;
};

function pump() {
  while (activeCount < MAX_CONCURRENT && pending.length) {
    const task = pending.shift();
    task?.();
  }
}

function runQueued(task: () => Promise<void>) {
  const start = () => {
    activeCount += 1;
    void task().finally(() => {
      activeCount -= 1;
      pump();
    });
  };
  pending.push(start);
  pump();
}

function isLowConfidenceLocalizedEstimate(card: TcgCard) {
  if (card.language === "en") {
    return false;
  }

  const hasVerifiedMarketSource =
    card.priceConsensus?.sources?.some((source) => {
      const score = source.confidenceScore ?? 0;

      return (
        source.evidenceType === "sold_comp" ||
        (source.evidenceType === "guide_snapshot" && score >= 0.5) ||
        /pricecharting|public guide|public sold|magery|grading market consensus/i.test(
          source.source ?? "",
        )
      );
    }) ||
    card.sources?.some((source) =>
      /pricecharting|public guide|public sold|magery|grading market consensus/i.test(
        source.source,
      ),
    ) ||
    card.gradedPrices?.some(
      (price) =>
        price.grade === "Ungraded" &&
        price.value > 0 &&
        /pricecharting|public guide|public sold|magery|consensus/i.test(price.source ?? ""),
    );

  if (hasVerifiedMarketSource) {
    return false;
  }

  const estimateSourcePatterns = [
    /early market estimate/i,
    /localized market estimate/i,
    /rarity estimate/i,
    /localized search group estimate/i,
  ];
  const sourceLooksEstimated =
    card.sources?.some((source) =>
      estimateSourcePatterns.some((pattern) => pattern.test(source.source)),
    ) ||
    card.priceConsensus?.sources?.some((source) =>
      estimateSourcePatterns.some((pattern) => pattern.test(source.source)),
    ) ||
    card.gradedPrices?.some(
      (price) =>
        price.grade === "Ungraded" &&
        estimateSourcePatterns.some((pattern) => pattern.test(price.source ?? "")),
    );
  const consensusSources = card.priceConsensus?.sources ?? [];
  const catalogOnlyPrice =
    getHeadlineMarketPriceUsd(card) > 0 &&
    (!consensusSources.length ||
      consensusSources.every((source) => source.evidenceType === "catalog"));

  return Boolean(
    sourceLooksEstimated ||
      catalogOnlyPrice ||
      (card.priceConsensus?.confidence === "low" &&
        (card.priceConsensus.confidenceScore ?? 1) < 0.4),
  );
}

function cardNeedsListPriceLookup(card: TcgCard) {
  if (!(getHeadlineMarketPriceUsd(card) > 0) || isLowConfidenceLocalizedEstimate(card)) {
    return true;
  }

  // English catalog prices are valid list baselines and do not need population,
  // slab, or sold-comp completeness. Only upgrade explicitly estimated values.
  const explicitEstimatePattern =
    /early market estimate|localized market estimate|rarity estimate|localized search group estimate/i;
  return Boolean(
    card.sources?.some((source) => explicitEstimatePattern.test(source.source)) ||
      card.priceConsensus?.sources?.some((source) =>
        explicitEstimatePattern.test(source.source),
      ) ||
      card.gradedPrices?.some(
        (price) =>
          price.grade === "Ungraded" &&
          explicitEstimatePattern.test(price.source ?? ""),
      ),
  );
}

/**
 * Lazily upgrade a list/grid row's price from the block-resistant `/api/price`
 * pipeline (cache-first + non-blocking APIs). Low-confidence localized prices
 * stay hidden behind loading until a verified guide/sold price arrives.
 */
export function useLazyCardPrice(card: TcgCard): {
  priceUsd: number;
  isLoading: boolean;
  isEstimate: boolean;
} {
  const initialPriceUsd = getHeadlineMarketPriceUsd(card);
  const initialLooksEstimated = isLowConfidenceLocalizedEstimate(card);
  const needsEnrichment = cardNeedsListPriceLookup(card);
  const priceLookupParams = buildPriceLookupParams(card).toString();
  const canRenderInitialPrice = initialPriceUsd > 0 && !initialLooksEstimated;
  const initialState: LazyPriceState = {
    slug: card.slug,
    priceUsd: canRenderInitialPrice ? initialPriceUsd : 0,
    isEstimate: canRenderInitialPrice ? initialLooksEstimated : false,
    isLoading: needsEnrichment,
  };
  const [state, setState] = useState<LazyPriceState>(() => initialState);
  const visibleState = state.slug === card.slug ? state : initialState;

  useEffect(() => {
    if (!needsEnrichment) {
      return;
    }

    const controller = new AbortController();

    runQueued(async () => {
      if (controller.signal.aborted) {
        return;
      }

      try {
        const response = await fetch(`/api/price?${priceLookupParams}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok || controller.signal.aborted) {
          return;
        }

        const data = (await response.json()) as PriceLookupPayload;

        if (controller.signal.aborted) {
          return;
        }

        // Only let a VERIFIED guide/sold price replace the row's estimate; a
        // catalog feed (which can be a mismatched low) must never win.
        const priceUsd = getPriceLookupUsd(data);

        if (isVerifiedPriceResult(data) && priceUsd) {
          setState({
            slug: card.slug,
            priceUsd,
            isEstimate: isEstimatedPriceResult(data),
            isLoading: false,
          });
        }
      } catch {
        // Best-effort; keep the server estimate on failure.
      } finally {
        if (!controller.signal.aborted) {
          setState((current) =>
            current.slug === card.slug
              ? { ...current, isLoading: false }
              : {
                  slug: card.slug,
                  priceUsd: canRenderInitialPrice ? initialPriceUsd : 0,
                  isEstimate: canRenderInitialPrice ? initialLooksEstimated : false,
                  isLoading: false,
                },
          );
        }
      }
    });

    return () => controller.abort();
  }, [
    canRenderInitialPrice,
    card.slug,
    initialLooksEstimated,
    initialPriceUsd,
    needsEnrichment,
    priceLookupParams,
  ]);

  return {
    priceUsd: visibleState.priceUsd,
    isLoading: visibleState.isLoading,
    isEstimate: visibleState.isEstimate,
  };
}
