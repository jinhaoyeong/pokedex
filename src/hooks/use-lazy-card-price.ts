"use client";

import { useEffect, useState } from "react";

import { getHeadlineMarketPriceUsd, isSuspiciouslyLowCatalogPrice } from "@/lib/localized-set-market";
import { isFirstEditionFinish } from "@/lib/card-finish";
import { cardHasPartialPreviewMarketData } from "@/lib/grading-market-lookup";
import {
  buildPriceLookupParams,
  pickTrustedMarketUsd,
  resolveLazyListPrice,
  type PriceLookupPayload,
} from "@/lib/price/price-query";
import type { TcgCard } from "@/types/pokemon";

// Bounded client-side queue so a 50-card page resolves prices in render order
// (top/visible cards first). Prices come from /api/price — cache-first and
// non-blocking — so the list never triggers a PriceCharting scrape burst.
const MAX_CONCURRENT = 16;
let activeCount = 0;
const pending: Array<() => void> = [];

type LazyPriceState = {
  slug: string;
  priceUsd: number;
  isEstimate: boolean;
  isLoading: boolean;
};

const TRUSTED_LIST_SOURCE =
  /pricecharting|collectr|public guide|public sold|ebay sold|grading market consensus/i;

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
        TRUSTED_LIST_SOURCE.test(source.source ?? "")
      );
    }) ||
    card.sources?.some((source) => TRUSTED_LIST_SOURCE.test(source.source)) ||
    card.gradedPrices?.some(
      (price) =>
        price.grade === "Ungraded" &&
        price.value > 0 &&
        TRUSTED_LIST_SOURCE.test(price.source ?? ""),
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

function cardHasTrustedListHeadline(card: TcgCard) {
  const headline = getHeadlineMarketPriceUsd(card);
  if (!(headline > 0) || cardHasPartialPreviewMarketData(card)) {
    return false;
  }

  if (isLowConfidenceLocalizedEstimate(card)) {
    return false;
  }

  if (
    isSuspiciouslyLowCatalogPrice({
      marketPriceUsd: headline,
      rarity: card.rarity,
      setName: card.setName,
      name: card.name,
      collectorNumber: card.collectorNumber,
      language: card.language,
    })
  ) {
    return false;
  }

  return Boolean(
    card.sources?.some((source) => TRUSTED_LIST_SOURCE.test(source.source)) ||
      card.priceConsensus?.sources?.some(
        (source) =>
          source.evidenceType === "guide_snapshot" ||
          source.evidenceType === "sold_comp" ||
          TRUSTED_LIST_SOURCE.test(source.source ?? ""),
      ) ||
      card.gradedPrices?.some(
        (price) =>
          price.grade === "Ungraded" && TRUSTED_LIST_SOURCE.test(price.source ?? ""),
      ),
  );
}

function cardNeedsListPriceLookup(card: TcgCard) {
  if (isFirstEditionFinish(card.finish) && !(getHeadlineMarketPriceUsd(card) > 0)) {
    return true;
  }

  return !cardHasTrustedListHeadline(card);
}

/**
 * Lazily upgrade a list/grid row's price from the block-resistant `/api/price`
 * pipeline (cache-first + non-blocking APIs). Known headlines stay visible while
 * trusted PriceCharting / Collectr / eBay sold comps confirm or replace them.
 */
export function useLazyCardPrice(card: TcgCard): {
  priceUsd: number;
  isLoading: boolean;
  isEstimate: boolean;
} {
  const initialPriceUsd = getHeadlineMarketPriceUsd(card);
  const initialLooksEstimated = isLowConfidenceLocalizedEstimate(card);
  const initialIsUntrusted =
    cardHasPartialPreviewMarketData(card) ||
    initialLooksEstimated ||
    isSuspiciouslyLowCatalogPrice({
      marketPriceUsd: initialPriceUsd,
      rarity: card.rarity,
      setName: card.setName,
      name: card.name,
      collectorNumber: card.collectorNumber,
      language: card.language,
    });
  const needsEnrichment = cardNeedsListPriceLookup(card);
  const priceLookupParams = buildPriceLookupParams(card).toString();
  const initialState: LazyPriceState = {
    slug: card.slug,
    priceUsd: initialPriceUsd > 0 ? initialPriceUsd : 0,
    isEstimate: false,
    isLoading: needsEnrichment && !(initialPriceUsd > 0),
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

        const trustedUsd = pickTrustedMarketUsd(data);

        if (card.language === "ja" && trustedUsd == null) {
          return;
        }

        const next = resolveLazyListPrice({
          incomingUsd: trustedUsd,
          initialUsd: initialPriceUsd,
          verified: trustedUsd != null,
          initialIsUntrusted,
        });

        if (next) {
          setState({
            slug: card.slug,
            priceUsd: next.priceUsd,
            isEstimate: next.isEstimate,
            isLoading: false,
          });
        }
      } catch {
        // Best-effort; keep the server estimate on failure.
      } finally {
        if (!controller.signal.aborted) {
          setState((current) => {
            const fallbackUsd = initialPriceUsd > 0 ? initialPriceUsd : 0;

            if (current.slug !== card.slug) {
              return {
                slug: card.slug,
                priceUsd: fallbackUsd,
                isEstimate: false,
                isLoading: false,
              };
            }

            return {
              ...current,
              isLoading: false,
              priceUsd: current.priceUsd > 0 ? current.priceUsd : fallbackUsd,
            };
          });
        }
      }
    });

    return () => controller.abort();
  }, [
    card.language,
    card.slug,
    initialIsUntrusted,
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
