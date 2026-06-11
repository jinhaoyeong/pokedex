"use client";

import { useEffect, useState } from "react";

import { buildGradingMarketParams } from "@/lib/grading-market-params";
import {
  getHeadlineMarketPriceUsd,
  isTrustedCatalogMarketPrice,
  shouldPreserveCatalogMarketPrice,
} from "@/lib/localized-set-market";
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

const LIVE_MARKET_TIMEOUT_MS = 45_000;

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

export function useCardGradingMarket(card: TcgCard) {
  const [enrichedCard, setEnrichedCard] = useState(card);
  const [isLoadingCore, setIsLoadingCore] = useState(true);
  const [isLoadingFull, setIsLoadingFull] = useState(true);

  useEffect(() => {
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

      setEnrichedCard((current) => mergeGradingMarketIntoCard(current, data));
    };

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
  }, [card]);

  return {
    enrichedCard,
    isLoadingCore,
    isLoadingFull,
    headlinePriceUsd: getHeadlineMarketPriceUsd(enrichedCard),
    priceConsensus: enrichedCard.priceConsensus,
  };
}
