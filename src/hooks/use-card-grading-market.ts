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
  getPriceLookupUsd,
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

function median(values: number[]) {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);
  if (!sorted.length) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isCatalogOnlyConsensus(consensus: PriceConsensus) {
  return (
    (consensus.sampleCount ?? 0) === 0 &&
    !consensus.sources.some((source) => source.evidenceType !== "catalog")
  );
}

function catalogPlaceholderValueFromConsensus(consensus: PriceConsensus) {
  const catalogValues = consensus.sources
    .filter((source) => source.evidenceType === "catalog" && source.value > 0)
    .map((source) => source.value);
  const nonCatalogValues = consensus.sources
    .filter((source) => source.evidenceType !== "catalog" && source.value > 0)
    .map((source) => source.value);

  if (!catalogValues.length || !nonCatalogValues.length) {
    return 0;
  }

  const lowCatalogValue = Math.min(...catalogValues);
  const baseline = median(nonCatalogValues);

  if (baseline >= 500 && lowCatalogValue < baseline * 0.25) {
    return lowCatalogValue;
  }

  const highCatalogValue = Math.max(...catalogValues);
  return baseline > 0 && highCatalogValue > Math.max(baseline * 4, baseline + 100)
    ? highCatalogValue
    : 0;
}

function consensusRejectsCatalogBaseline(consensus: PriceConsensus) {
  return /catalog baseline looked like/i.test(consensus.methodology);
}

function stabilizedCatalogOnlyPrice(history: PricePoint[], rawEstimateUsd: number) {
  if (!(rawEstimateUsd > 0) || !history.length) {
    return null;
  }

  const baseline = median(
    history
      .map((point) => point.value)
      .filter(
        (value) =>
          Number.isFinite(value) &&
          value > 0 &&
          Math.abs(value - rawEstimateUsd) > Math.max(rawEstimateUsd * 0.04, 1),
      ),
  );

  if (!(baseline > 0)) {
    return null;
  }

  const highSpike = rawEstimateUsd > Math.max(baseline * 1.8, baseline + 500);
  const lowCollapse = baseline > 100 && rawEstimateUsd < baseline / 4;

  return highSpike || lowCollapse ? Math.round(baseline * 100) / 100 : null;
}

function stabilizeCatalogOnlyHistory(
  history: PricePoint[],
  rawEstimateUsd: number,
  stabilizedEstimateUsd: number,
) {
  const spikeThreshold = Math.max(stabilizedEstimateUsd * 1.8, stabilizedEstimateUsd + 500);
  const collapseThreshold = stabilizedEstimateUsd / 4;

  return history.map((point) => {
    const valueIsOutlier =
      point.value > spikeThreshold ||
      (stabilizedEstimateUsd > 100 && point.value > 0 && point.value < collapseThreshold) ||
      Math.abs(point.value - rawEstimateUsd) <= Math.max(rawEstimateUsd * 0.04, 1);
    const gradeValues = point.gradeValues
      ? Object.fromEntries(
          Object.entries(point.gradeValues).map(([grade, value]) => {
            if (grade !== "Ungraded") {
              return [grade, value];
            }

            const gradeValueIsOutlier =
              value > spikeThreshold ||
              (stabilizedEstimateUsd > 100 && value > 0 && value < collapseThreshold) ||
              Math.abs(value - rawEstimateUsd) <= Math.max(rawEstimateUsd * 0.04, 1);

            return [grade, gradeValueIsOutlier ? stabilizedEstimateUsd : value];
          }),
        )
      : point.gradeValues;

    return {
      ...point,
      value: valueIsOutlier ? stabilizedEstimateUsd : point.value,
      gradeValues,
    };
  });
}

function mergeGradingMarketIntoCard(current: TcgCard, data: GradingMarketPayload): TcgCard {
  const incomingConsensus = data.priceConsensus;
  const mergedHistory = mergePriceHistory(current.priceHistory, data.priceHistory ?? []);
  const preserveCatalogPrice =
    incomingConsensus &&
    !consensusRejectsCatalogBaseline(incomingConsensus) &&
    shouldPreserveCatalogMarketPrice(current.marketPriceUsd, incomingConsensus.finalEstimateUsd, {
      soldCompCount: incomingConsensus.sampleCount,
      catalogTrusted: isTrustedCatalogMarketPrice(current),
    });
  let nextConsensus =
    incomingConsensus && preserveCatalogPrice
      ? {
          ...incomingConsensus,
          finalEstimateUsd: current.marketPriceUsd,
        }
      : incomingConsensus;
  const rawConsensusEstimate = nextConsensus?.finalEstimateUsd ?? 0;
  const catalogOnlyConsensus = nextConsensus ? isCatalogOnlyConsensus(nextConsensus) : false;
  const catalogPlaceholderValue = nextConsensus
    ? catalogPlaceholderValueFromConsensus(nextConsensus)
    : 0;
  const stabilizedEstimate =
    nextConsensus && catalogOnlyConsensus
      ? stabilizedCatalogOnlyPrice(mergedHistory, rawConsensusEstimate)
      : null;
  const nextHistory =
    stabilizedEstimate && nextConsensus
      ? stabilizeCatalogOnlyHistory(mergedHistory, rawConsensusEstimate, stabilizedEstimate)
      : nextConsensus && catalogPlaceholderValue > 0 && nextConsensus.finalEstimateUsd > 0
        ? stabilizeCatalogOnlyHistory(
            mergedHistory,
            catalogPlaceholderValue,
            nextConsensus.finalEstimateUsd,
          )
      : mergedHistory;

  if (nextConsensus && catalogOnlyConsensus) {
    nextConsensus = {
      ...nextConsensus,
      finalEstimateUsd: stabilizedEstimate ?? nextConsensus.finalEstimateUsd,
      confidence: "low",
      confidenceScore: Math.min(nextConsensus.confidenceScore, stabilizedEstimate ? 0.38 : 0.44),
      methodology: `${nextConsensus.methodology} Catalog-only result is treated as low confidence until guide, population-price, or sold-comp evidence corroborates it.`,
    };
  }

  const mergedCard: TcgCard = {
    ...current,
    psaPopulation: shouldUseLivePopulation(data.psaPopulation, current.psaPopulation)
      ? data.psaPopulation!
      : current.psaPopulation,
    marketPriceUsd: current.marketPriceUsd,
    gradedPrices: data.gradedPrices?.length ? data.gradedPrices : current.gradedPrices,
    priceHistory: nextHistory,
    recentSales: data.recentSales?.length ? data.recentSales : current.recentSales,
    evidenceSummary: data.evidenceSummary ?? current.evidenceSummary,
    sourceStatus: data.sourceStatus ?? data.evidenceSummary?.sourceStatus ?? current.sourceStatus,
    marketEvidence: data.marketEvidence ?? current.marketEvidence,
    priceConsensus: nextConsensus ?? current.priceConsensus,
  };

  if (nextConsensus && catalogOnlyConsensus) {
    mergedCard.gradedPrices = mergedCard.gradedPrices.map((price) =>
      price.grade === "Ungraded"
        ? {
            ...price,
            value: nextConsensus.finalEstimateUsd,
            confidence: "low" as const,
            confidenceScore: nextConsensus.confidenceScore,
            warning:
              "Catalog-only estimate; use population and grade references until guide or sold-comp evidence corroborates raw value.",
          }
        : price,
    );
  }

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
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? (response.json() as Promise<PriceLookupPayload>) : null))
      .then((data) => {
        if (!data || controller.signal.aborted || !isVerifiedPriceResult(data)) {
          return;
        }
        // Whichever alias the API answered with (ungradedUsd / marketPrice /
        // prices.market), read it through the shared normaliser.
        const verifiedUsd = getPriceLookupUsd(data);
        if (!verifiedUsd) {
          return;
        }
        priceOverrideRef.current = verifiedUsd;
        setEnrichedCard((current) => applyPriceOverride(current, verifiedUsd));
      })
      .catch(() => undefined);

    const fetchPhase = (mode: "core" | "full") =>
      fetch(`/api/grading-market?${buildGradingMarketParams(card, mode).toString()}`, {
        cache: "no-store",
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
