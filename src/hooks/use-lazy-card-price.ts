"use client";

import { useEffect, useState } from "react";

import { cardNeedsGradingMarketEnrichment } from "@/lib/grading-market-lookup";
import { buildGradingMarketParams } from "@/lib/grading-market-params";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import type { GradedPrice, PriceConsensus, TcgCard } from "@/types/pokemon";

type GradingMarketCorePayload = {
  gradedPrices?: GradedPrice[];
  priceConsensus?: PriceConsensus;
};

// Bounded client-side queue so a 50-card page never fires 50 PriceCharting
// scrapes at once. Rows enqueue in render order, so the top (visible) cards
// resolve first; the /api/grading-market responses are CDN-cached, so repeat
// views are cheap.
const MAX_CONCURRENT = 4;
let activeCount = 0;
const pending: Array<() => void> = [];

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

  const estimateSourcePatterns = [
    /early market estimate/i,
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

  return Boolean(
    sourceLooksEstimated ||
      (card.priceConsensus?.confidence === "low" &&
        (card.priceConsensus.confidenceScore ?? 1) < 0.4),
  );
}

/**
 * Lazily resolve a card's real market price for list/grid rows.
 *
 * The search list is rendered fast on the server with catalog/estimate prices,
 * because resolving real prices means scraping PriceCharting/magery which is too
 * slow and times out under production latency when done for a whole page at once
 * (that's why list prices showed a low estimate while the card detail page —
 * which fetches one card client-side — showed the correct price).
 *
 * This hook fixes that by reusing the exact same `/api/grading-market` endpoint
 * the detail page uses, through a small bounded queue so the page stays
 * responsive and we never fire a whole page of scrapes at once.
 */
export function useLazyCardPrice(card: TcgCard): { priceUsd: number; isLoading: boolean } {
  const needsEnrichment = cardNeedsGradingMarketEnrichment(card);
  const [priceUsd, setPriceUsd] = useState(() =>
    isLowConfidenceLocalizedEstimate(card) ? 0 : getHeadlineMarketPriceUsd(card),
  );
  const [isLoading, setIsLoading] = useState(needsEnrichment);

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
        const response = await fetch(
          `/api/grading-market?${buildGradingMarketParams(card, "core").toString()}`,
          { signal: controller.signal },
        );

        if (!response.ok || controller.signal.aborted) {
          return;
        }

        const data = (await response.json()) as GradingMarketCorePayload;

        if (controller.signal.aborted) {
          return;
        }

        const merged: TcgCard = {
          ...card,
          gradedPrices: data.gradedPrices?.length ? data.gradedPrices : card.gradedPrices,
          priceConsensus: data.priceConsensus ?? card.priceConsensus,
          marketPriceUsd:
            data.priceConsensus?.finalEstimateUsd ??
            (isLowConfidenceLocalizedEstimate(card) ? 0 : card.marketPriceUsd),
        };
        const headline = getHeadlineMarketPriceUsd(merged);

        if (headline > 0 && !isLowConfidenceLocalizedEstimate(merged)) {
          setPriceUsd(headline);
        }
      } catch {
        // Best-effort; keep the server estimate on failure.
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    });

    return () => controller.abort();
  }, [card, needsEnrichment]);

  return { priceUsd, isLoading };
}
