"use client";

import { useEffect, useRef, useState } from "react";

import { cardNeedsGradingMarketEnrichment } from "@/lib/grading-market-lookup";
import { buildGradingMarketParams } from "@/lib/grading-market-params";
import {
  getHeadlineMarketPriceUsd,
  isTrustedCatalogMarketPrice,
  shouldPreserveCatalogMarketPrice,
} from "@/lib/localized-set-market";
import {
  buildPriceLookupParams,
  isVerifiedPriceResult,
  type PriceLookupPayload,
} from "@/lib/price/price-query";
import type {
  EvidenceSummary,
  GradedPrice,
  MarketEvidence,
  MarketSourceStatus,
  PriceConsensus,
  PricePoint,
  PsaPopulationSnapshot,
  SaleRecord,
  TcgCard,
} from "@/types/pokemon";

const LIVE_MARKET_TIMEOUT_MS = 55_000;

export type GradingMarketPayload = {
  psaPopulation: PsaPopulationSnapshot | null;
  gradedPrices: GradedPrice[];
  priceHistory: PricePoint[];
  recentSales: SaleRecord[];
  evidenceSummary?: EvidenceSummary;
  sourceStatus?: MarketSourceStatus[];
  marketEvidence?: MarketEvidence[];
  priceConsensus?: PriceConsensus;
};

function shouldUseLivePopulation(
  live: PsaPopulationSnapshot | null | undefined,
  current: PsaPopulationSnapshot,
) {
  if (!live) {
    return false;
  }

  return live.grades.length > 0 || typeof live.totalCertified === "number" || !current.grades.length;
}

function mergePriceHistory(current: PricePoint[], incoming: PricePoint[]) {
  if (!incoming.length) {
    return current;
  }

  const byDate = new Map(current.map((point) => [point.date, point]));

  for (const point of incoming) {
    byDate.set(point.date, point);
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function mergeGradingMarketIntoCard(current: TcgCard, data: GradingMarketPayload): TcgCard {
  const incomingConsensus = data.priceConsensus;
  const preserveCatalogPrice =
    incomingConsensus &&
    shouldPreserveCatalogMarketPrice(current.marketPriceUsd, incomingConsensus.finalEstimateUsd, {
      soldCompCount: incomingConsensus.sampleCount,
      catalogTrusted: isTrustedCatalogMarketPrice(current),
    });
  const nextConsensus =
    incomingConsensus && preserveCatalogPrice
      ? {
          ...incomingConsensus,
          finalEstimateUsd: current.marketPriceUsd,
        }
      : incomingConsensus;
  const mergedCard: TcgCard = {
    ...current,
    psaPopulation: shouldUseLivePopulation(data.psaPopulation, current.psaPopulation)
      ? data.psaPopulation!
      : current.psaPopulation,
    marketPriceUsd: nextConsensus?.finalEstimateUsd ?? current.marketPriceUsd,
    gradedPrices: data.gradedPrices?.length ? data.gradedPrices : current.gradedPrices,
    priceHistory: mergePriceHistory(current.priceHistory, data.priceHistory ?? []),
    recentSales: data.recentSales?.length ? data.recentSales : current.recentSales,
    evidenceSummary: data.evidenceSummary ?? current.evidenceSummary,
    sourceStatus: data.sourceStatus ?? data.evidenceSummary?.sourceStatus ?? current.sourceStatus,
    marketEvidence: data.marketEvidence ?? current.marketEvidence,
    priceConsensus: nextConsensus ?? current.priceConsensus,
  };
  mergedCard.marketPriceUsd = getHeadlineMarketPriceUsd(mergedCard);

  return mergedCard;
}

/**
 * Force the headline to a verified, block-resistant price from /api/price so the
 * grading-market consensus (which may be a stale/mismatched scrape) can't override
 * a trusted guide/sold figure. Population, graded values and the chart still come
 * from the grading-market payload.
 */
function applyPriceOverride(card: TcgCard, priceUsd: number): TcgCard {
  return {
    ...card,
    marketPriceUsd: priceUsd,
    priceConsensus: card.priceConsensus
      ? { ...card.priceConsensus, finalEstimateUsd: priceUsd }
      : card.priceConsensus,
  };
}

function scheduleGradingCacheRefresh(slug: string) {
  void fetch("/api/card-cache/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  }).catch(() => undefined);
}

export function useCardGradingMarket(card: TcgCard) {
  const needsEnrichment = cardNeedsGradingMarketEnrichment(card);
  const [enrichedCard, setEnrichedCard] = useState(card);
  const [isLoadingCore, setIsLoadingCore] = useState(needsEnrichment);
  const [isLoadingFull, setIsLoadingFull] = useState(needsEnrichment);
  // Verified price from /api/price, applied over the grading-market consensus.
  const priceOverrideRef = useRef(0);

  useEffect(() => {
    if (!needsEnrichment) {
      return;
    }

    priceOverrideRef.current = 0;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      setIsLoadingCore(false);
      setIsLoadingFull(false);
    }, LIVE_MARKET_TIMEOUT_MS);

    const applyData = (data: GradingMarketPayload | null) => {
      if (!data || controller.signal.aborted) {
        return;
      }

      setEnrichedCard((current) => {
        let merged = mergeGradingMarketIntoCard(current, data);
        if (priceOverrideRef.current > 0) {
          merged = applyPriceOverride(merged, priceOverrideRef.current);
        }

        if (!cardNeedsGradingMarketEnrichment(merged)) {
          scheduleGradingCacheRefresh(merged.slug);
        }

        return merged;
      });
    };

    // Block-resistant price: resolved from /api/price (cache-first, non-blocking).
    // A verified guide/sold price wins the headline regardless of what the
    // grading-market scrape returns or in what order the two requests land.
    void fetch(`/api/price?${buildPriceLookupParams(card).toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? (response.json() as Promise<PriceLookupPayload>) : null))
      .then((data) => {
        if (!data || controller.signal.aborted || !isVerifiedPriceResult(data)) {
          return;
        }
        priceOverrideRef.current = data.ungradedUsd!;
        setEnrichedCard((current) => applyPriceOverride(current, data.ungradedUsd!));
      })
      .catch(() => undefined);

    const fetchPhase = (mode: "core" | "full") =>
      fetch(`/api/grading-market?${buildGradingMarketParams(card, mode).toString()}`, {
        signal: controller.signal,
      })
        .then((response) => response.json().catch(() => null) as Promise<GradingMarketPayload | null>)
        .then(applyData)
        .catch(() => undefined);

    fetchPhase("core").finally(() => {
      if (!controller.signal.aborted) {
        setIsLoadingCore(false);
      }
    });
    fetchPhase("full").finally(() => {
      if (!controller.signal.aborted) {
        setIsLoadingFull(false);
        window.clearTimeout(timeoutId);
      }
    });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [card, needsEnrichment]);

  const resolvedCard = needsEnrichment ? enrichedCard : card;

  return {
    enrichedCard: resolvedCard,
    isLoadingCore: needsEnrichment ? isLoadingCore : false,
    isLoadingFull: needsEnrichment ? isLoadingFull : false,
    headlinePriceUsd: getHeadlineMarketPriceUsd(resolvedCard),
    priceConsensus: resolvedCard.priceConsensus,
  };
}
