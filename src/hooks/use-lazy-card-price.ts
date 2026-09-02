"use client";

import { useEffect, useState } from "react";

import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import {
  cardNeedsListPriceLookup,
  isLowConfidenceLocalizedEstimate,
} from "@/lib/price/list-price-trust";
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
const MAX_CONCURRENT = 8;
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

/**
 * Lazily upgrade a list/grid row's price from the block-resistant `/api/price`
 * pipeline (cache-first + non-blocking APIs). Low-confidence localized prices
 * stay hidden behind loading until a verified guide/sold price arrives.
 */
export function useLazyCardPrice(
  card: TcgCard,
  options: { enabled?: boolean } = {},
): {
  priceUsd: number;
  isLoading: boolean;
  isEstimate: boolean;
} {
  const enabled = options.enabled !== false;
  const initialPriceUsd = getHeadlineMarketPriceUsd(card);
  const initialLooksEstimated = isLowConfidenceLocalizedEstimate(card);
  const needsEnrichment = cardNeedsListPriceLookup(card);
  const priceLookupParams = buildPriceLookupParams(card).toString();
  const canRenderInitialPrice = initialPriceUsd > 0 && !initialLooksEstimated;
  const shouldLookup = enabled && needsEnrichment;
  const requestKey = `${card.slug}:${priceLookupParams}:${enabled ? "on" : "off"}`;
  const initialState: LazyPriceState = {
    requestKey,
    slug: card.slug,
    priceUsd: canRenderInitialPrice ? initialPriceUsd : 0,
    isEstimate: false,
    isLoading: needsEnrichment && !canRenderInitialPrice,
  };
  const [state, setState] = useState<LazyPriceState>(() => initialState);
  const visibleState = state.requestKey === requestKey ? state : initialState;

  useEffect(() => {
    if (!shouldLookup) {
      return;
    }

    const controller = new AbortController();
    let resolved = false;

    const fallbackState = (): LazyPriceState => ({
      requestKey,
      slug: card.slug,
      priceUsd: canRenderInitialPrice ? initialPriceUsd : 0,
      isEstimate: false,
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

        if (!reliable && (initialLooksEstimated || !canRenderInitialPrice)) {
          return;
        }

        const next = resolveLazyListPrice({
          incomingUsd: priceUsd,
          initialUsd: canRenderInitialPrice ? initialPriceUsd : 0,
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
        // Keep the tile unavailable instead of exposing a provisional estimate.
      }
    };

    runQueued(async () => {
      await lookup();
      if (!controller.signal.aborted && !resolved && card.language !== "ja") {
        setState((current) =>
          current.requestKey === requestKey
            ? { ...current, isLoading: false }
            : fallbackState(),
        );
      }
    });

    const finishLoadingIfUnresolved = () => {
      if (controller.signal.aborted || resolved) {
        return;
      }
      setState((current) =>
        current.requestKey === requestKey
          ? { ...current, isLoading: false }
          : fallbackState(),
      );
    };

    const retryTimers =
      card.language === "ja"
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

    return () => {
      controller.abort();
      for (const timer of retryTimers) {
        window.clearTimeout(timer);
      }
    };
  }, [
    canRenderInitialPrice,
    card.language,
    card.slug,
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
