"use client";

import { useEffect, useState } from "react";

import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { isFirstEditionFinish } from "@/lib/card-finish";
import { cardHasPartialPreviewMarketData } from "@/lib/grading-market-lookup";
import {
  buildPriceLookupParams,
  getPriceLookupUsd,
  isReliablePriceResult,
  isVerifiedPriceResult,
  resolveLazyListPrice,
  type PriceLookupPayload,
} from "@/lib/price/price-query";
import type { TcgCard } from "@/types/pokemon";

// Bounded client-side queue so a 50-card page resolves prices in render order
// (top/visible cards first). Prices come from /api/price — cache-first and
// non-blocking — so the list never triggers a PriceCharting scrape burst.
const MAX_CONCURRENT = 4;
const DEFERRED_LOOKUP_TIMEOUT_MS = 8_000;
let activeCount = 0;
const pending: Array<() => void> = [];

type LazyPriceState = {
  requestKey: string;
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
  const headline = getHeadlineMarketPriceUsd(card);

  // Showcase/static rows already have a list price. Forcing /api/price on them
  // blanked Dex tiles ("Price pending") or replaced them with wrong estimates
  // (Rayquaza Gold Star ~$27 instead of the curated market).
  if (cardHasPartialPreviewMarketData(card)) {
    return !(headline > 0);
  }

  if (isFirstEditionFinish(card.finish) && !(headline > 0)) {
    return true;
  }

  if (!(headline > 0) || isLowConfidenceLocalizedEstimate(card)) {
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
export function useLazyCardPrice(
  card: TcgCard,
  options: { deferUntilResolved?: boolean } = {},
): {
  priceUsd: number;
  isLoading: boolean;
  isEstimate: boolean;
} {
  const initialPriceUsd = getHeadlineMarketPriceUsd(card);
  const initialLooksEstimated = isLowConfidenceLocalizedEstimate(card);
  const needsEnrichment = cardNeedsListPriceLookup(card);
  const deferUntilResolved = options.deferUntilResolved === true;
  const hasPartialPreviewMarketData = cardHasPartialPreviewMarketData(card);
  const priceLookupParams = buildPriceLookupParams(card).toString();
  const canRenderInitialPrice =
    initialPriceUsd > 0 &&
    !initialLooksEstimated &&
    (!deferUntilResolved || hasPartialPreviewMarketData);
  const shouldLookup =
    needsEnrichment || (deferUntilResolved && !hasPartialPreviewMarketData);
  const requestKey = [
    card.slug,
    priceLookupParams,
    deferUntilResolved ? "deferred" : "eager",
  ].join(":");
  const initialState: LazyPriceState = {
    requestKey,
    slug: card.slug,
    priceUsd: canRenderInitialPrice ? initialPriceUsd : 0,
    isEstimate: false,
    isLoading: shouldLookup && !canRenderInitialPrice,
  };
  const [state, setState] = useState<LazyPriceState>(() => initialState);
  const visibleState = state.requestKey === requestKey ? state : initialState;

  useEffect(() => {
    if (!shouldLookup) {
      return;
    }

    const controller = new AbortController();
    let resolved = false;
    let timedOut = false;

    const fallbackState = (): LazyPriceState => ({
      requestKey,
      slug: card.slug,
      priceUsd: canRenderInitialPrice ? initialPriceUsd : 0,
      isEstimate: canRenderInitialPrice ? initialLooksEstimated : false,
      isLoading: false,
    });

    const lookup = async () => {
      if (controller.signal.aborted || resolved) {
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

        const priceUsd = getPriceLookupUsd(data);
        const verified = isVerifiedPriceResult(data);
        const reliable = isReliablePriceResult(data);

        if (card.language === "ja" && !verified) {
          return;
        }

        // A price-sort transaction must never reveal a catalog estimate while
        // the exact lookup is settling. The caller will either get a verified
        // value or an honest unavailable state after this request completes.
        if (deferUntilResolved && !reliable) {
          return;
        }

        const next = resolveLazyListPrice({
          incomingUsd: priceUsd,
          initialUsd: initialPriceUsd,
          verified,
        });

        if (next) {
          resolved = true;
          setState({
            requestKey,
            slug: card.slug,
            priceUsd: next.priceUsd,
            isEstimate: next.isEstimate,
            isLoading: false,
          });
        }
      } catch {
        // Deferred price sorting settles to unavailable instead of exposing
        // the provisional server value after a failed lookup.
      }
    };

    runQueued(async () => {
      await lookup();
      if (
        !controller.signal.aborted &&
        !resolved &&
        (card.language !== "ja" || deferUntilResolved)
      ) {
        setState((current) =>
          current.requestKey === requestKey
            ? { ...current, isLoading: false }
            : fallbackState(),
        );
      }
    });

    const finishLoadingIfUnresolved = () => {
      if ((controller.signal.aborted && !timedOut) || resolved) {
        return;
      }
      setState((current) =>
        current.requestKey === requestKey
          ? { ...current, isLoading: false }
          : fallbackState(),
      );
    };

    const retryTimers =
      !deferUntilResolved && card.language === "ja"
        ? [
            window.setTimeout(() => {
              if (resolved || controller.signal.aborted) {
                finishLoadingIfUnresolved();
                return;
              }
              runQueued(async () => {
                await lookup();
                finishLoadingIfUnresolved();
              });
            }, 4_000),
            window.setTimeout(() => {
              if (resolved || controller.signal.aborted) {
                return;
              }
              runQueued(lookup);
            }, 12_000),
          ]
        : [];
    const deferredTimeout = deferUntilResolved
      ? window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          finishLoadingIfUnresolved();
        }, DEFERRED_LOOKUP_TIMEOUT_MS)
      : null;

    return () => {
      controller.abort();
      if (deferredTimeout !== null) {
        window.clearTimeout(deferredTimeout);
      }
      for (const timer of retryTimers) {
        window.clearTimeout(timer);
      }
    };
  }, [
    canRenderInitialPrice,
    card.language,
    card.slug,
    deferUntilResolved,
    initialLooksEstimated,
    initialPriceUsd,
    requestKey,
    priceLookupParams,
    shouldLookup,
  ]);

  return {
    priceUsd: visibleState.priceUsd,
    isLoading: visibleState.isLoading,
    isEstimate: visibleState.isEstimate,
  };
}
