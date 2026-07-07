"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  cardHasPartialPreviewMarketData,
  cardNeedsGradingMarketEnrichment,
} from "@/lib/grading-market-lookup";
import { buildGradingMarketParams } from "@/lib/grading-market-params";
import {
  getHeadlineMarketPriceUsd,
  isTrustedCatalogMarketPrice,
  shouldPreserveCatalogMarketPrice,
} from "@/lib/localized-set-market";
import {
  buildPriceLookupParams,
  getPriceLookupUsd,
  isEstimatedPriceResult,
  isVerifiedPriceResult,
  type PriceLookupPayload,
  type PriceLookupProviderResult,
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

function primaryPriceProviderResult(data: PriceLookupPayload): PriceLookupProviderResult | undefined {
  return (
    data.results?.find((result) => result.provider === data.primaryProvider) ??
    data.results?.find((result) => result.ungradedUsd && result.ungradedUsd > 0)
  );
}

function mergeGradedPrices(current: GradedPrice[], incoming: GradedPrice[] | undefined) {
  if (!incoming?.length) {
    return current;
  }

  const byGrade = new Map(current.map((price) => [price.grade, price]));

  for (const price of incoming) {
    if (price.value > 0) {
      byGrade.set(price.grade, price);
    }
  }

  return [...byGrade.values()];
}

function mergeRecentSales(current: SaleRecord[], incoming: SaleRecord[] | undefined) {
  if (!incoming?.length) {
    return current;
  }

  const byKey = new Map(
    current.map((sale) => [`${sale.date}:${sale.title}:${sale.price}`, sale]),
  );

  for (const sale of incoming) {
    byKey.set(`${sale.date}:${sale.title}:${sale.price}`, sale);
  }

  return [...byKey.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function applyVerifiedPricePayload(card: TcgCard, data: PriceLookupPayload, priceUsd: number): TcgCard {
  const providerResult = primaryPriceProviderResult(data);
  const isEstimate = isEstimatedPriceResult(data);
  const sourceName =
    providerResult?.sourceLabel ?? providerResult?.provider ?? data.primaryProvider ?? "Price API";
  const confidenceScore =
    data.confidenceScore ?? providerResult?.confidenceScore ?? card.priceConsensus?.confidenceScore ?? 0.5;
  const confidence =
    confidenceScore >= 0.72 ? "high" : confidenceScore >= 0.5 ? "medium" : "low";
  const nextCard: TcgCard = {
    ...card,
    marketPriceUsd: priceUsd,
    gradedPrices: mergeGradedPrices(card.gradedPrices, providerResult?.gradedPrices),
    recentSales: mergeRecentSales(card.recentSales, providerResult?.sales),
    sourceStatus: [
      {
        source: sourceName,
        state: "ready",
        confidence,
        confidenceScore,
        note: "Verified block-resistant price lookup shared by mobile and desktop card views.",
        fetchedAt: data.fetchedAt ?? providerResult?.fetchedAt,
        sourceUrl: providerResult?.sourceUrl,
        sampleCount: providerResult?.sampleCount,
        warning: isEstimate ? "Fast catalog estimate; waiting for stronger market evidence." : undefined,
      },
      ...(card.sourceStatus ?? []).filter((status) => status.source !== sourceName),
    ],
    evidenceSummary: {
      accepted:
        providerResult?.sampleCount ??
        providerResult?.sales?.length ??
        card.evidenceSummary?.accepted ??
        1,
      rejected: card.evidenceSummary?.rejected ?? 0,
      thin: card.evidenceSummary?.thin ?? 0,
      fallback: card.evidenceSummary?.fallback ?? 0,
      sourceStatus: [
        {
          source: sourceName,
          state: "ready",
          confidence,
          confidenceScore,
          note: "Verified block-resistant price lookup shared by mobile and desktop card views.",
          fetchedAt: data.fetchedAt ?? providerResult?.fetchedAt,
          sourceUrl: providerResult?.sourceUrl,
          sampleCount: providerResult?.sampleCount,
          warning: isEstimate ? "Fast catalog estimate; waiting for stronger market evidence." : undefined,
        },
        ...(card.evidenceSummary?.sourceStatus ?? []).filter(
          (status) => status.source !== sourceName,
        ),
      ],
    },
    priceConsensus: {
      finalEstimateUsd: priceUsd,
      confidence,
      confidenceScore,
      sourceCount: Math.max(1, data.results?.length ?? card.priceConsensus?.sourceCount ?? 1),
      sampleCount:
        providerResult?.sampleCount ??
        providerResult?.sales?.length ??
        card.priceConsensus?.sampleCount ??
        1,
      methodology: isEstimate
        ? "Fast catalog estimate from the price API; stronger guide, population, or sold-comp evidence can replace it asynchronously."
        : "Verified price API result shared across responsive card layouts.",
      sources: [
        {
          source: sourceName,
          value: priceUsd,
          confidence,
          confidenceScore,
          evidenceType: providerResult?.evidenceType ?? "guide_snapshot",
          sampleCount: providerResult?.sampleCount,
          sourceUrl: providerResult?.sourceUrl,
          note: "Primary provider selected by the price resolver.",
        },
      ],
      salesReport: card.priceConsensus?.salesReport,
    },
  };

  return nextCard;
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
  const forceFullHydration = cardHasPartialPreviewMarketData(card);
  const [enrichedState, setEnrichedState] = useState(() => ({
    sourceSlug: card.slug,
    card,
  }));
  const enrichedCard = enrichedState.sourceSlug === card.slug ? enrichedState.card : card;
  const [isLoadingCore, setIsLoadingCore] = useState(needsEnrichment);
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  // Verified price from /api/price, applied over the grading-market consensus.
  const priceOverrideRef = useRef(0);
  const pricePayloadRef = useRef<PriceLookupPayload | null>(null);
  const fullRequestedRef = useRef(false);
  const fullControllerRef = useRef<AbortController | null>(null);

  const applyGradingData = useCallback((data: GradingMarketPayload | null, signal?: AbortSignal) => {
      if (!data || signal?.aborted) {
        return;
      }

      setEnrichedState((current) => {
        const currentCard = current.sourceSlug === card.slug ? current.card : card;
        let merged = mergeGradingMarketIntoCard(currentCard, data);
        if (priceOverrideRef.current > 0 && pricePayloadRef.current) {
          merged = applyVerifiedPricePayload(
            merged,
            pricePayloadRef.current,
            priceOverrideRef.current,
          );
        } else if (priceOverrideRef.current > 0) {
          merged = applyPriceOverride(merged, priceOverrideRef.current);
        }

        if (!cardNeedsGradingMarketEnrichment(merged)) {
          scheduleGradingCacheRefresh(merged.slug);
        }

        return {
          sourceSlug: card.slug,
          card: merged,
        };
      });
    }, [card]);

  const fetchGradingPhase = useCallback(
    (mode: "core" | "full", signal: AbortSignal) =>
      fetch(`/api/grading-market?${buildGradingMarketParams(card, mode).toString()}`, {
        cache: "no-store",
        signal,
      })
        .then((response) => response.json().catch(() => null) as Promise<GradingMarketPayload | null>)
        .then((data) => applyGradingData(data, signal))
        .catch(() => undefined),
    [applyGradingData, card],
  );

  const startFullMarketFetch = useCallback(() => {
    fullRequestedRef.current = true;
    fullControllerRef.current?.abort();
    const controller = new AbortController();
    fullControllerRef.current = controller;
    setIsLoadingFull(true);

    const timeoutId = window.setTimeout(() => {
      controller.abort();
      setIsLoadingFull(false);
    }, LIVE_MARKET_TIMEOUT_MS);

    void fetchGradingPhase("full", controller.signal).finally(() => {
      if (!controller.signal.aborted) {
        setIsLoadingFull(false);
      }
      window.clearTimeout(timeoutId);
    });
  }, [fetchGradingPhase]);

  const requestFullMarket = useCallback(() => {
    if (!needsEnrichment || fullRequestedRef.current) {
      return;
    }

    startFullMarketFetch();
  }, [needsEnrichment, startFullMarketFetch]);

  useEffect(() => {
    priceOverrideRef.current = 0;
    pricePayloadRef.current = null;
    fullRequestedRef.current = false;
    fullControllerRef.current?.abort();
    fullControllerRef.current = null;
    const controller = new AbortController();

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }

      setIsLoadingFull(false);
      setIsLoadingCore(needsEnrichment);
    });

    if (!needsEnrichment) {
      return () => {
        controller.abort();
        fullControllerRef.current?.abort();
        fullControllerRef.current = null;
      };
    }

    const timeoutId = window.setTimeout(() => {
      controller.abort();
      setIsLoadingCore(false);
    }, LIVE_MARKET_TIMEOUT_MS);

    const applyPriceData = (data: PriceLookupPayload | null) => {
      if (!data || controller.signal.aborted || !isVerifiedPriceResult(data)) {
        return;
      }

      const verifiedUsd = getPriceLookupUsd(data);
      if (!verifiedUsd) {
        return;
      }

      priceOverrideRef.current = verifiedUsd;
      pricePayloadRef.current = data;
      setEnrichedState((current) => {
        const currentCard = current.sourceSlug === card.slug ? current.card : card;
        return {
          sourceSlug: card.slug,
          card: applyVerifiedPricePayload(currentCard, data, verifiedUsd),
        };
      });
    };

    async function runStagedEnrichment() {
      try {
        const response = await fetch(`/api/price?${buildPriceLookupParams(card).toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const priceData = response.ok ? ((await response.json()) as PriceLookupPayload) : null;
        applyPriceData(priceData);
      } catch {
        // Price lookup is best-effort; the card keeps its existing catalog value.
      } finally {
        if (!controller.signal.aborted) {
          // Stage 1 is complete. Stop blocking the UI before slower grading work starts.
          setIsLoadingCore(false);
        }
      }

      if (controller.signal.aborted) {
        return;
      }

      await fetchGradingPhase("core", controller.signal);

      if (
        forceFullHydration &&
        !controller.signal.aborted &&
        !fullRequestedRef.current
      ) {
        startFullMarketFetch();
      }
    }

    void runStagedEnrichment().finally(() => {
      window.clearTimeout(timeoutId);
    });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
      fullControllerRef.current?.abort();
      fullControllerRef.current = null;
    };
  }, [
    applyGradingData,
    card,
    fetchGradingPhase,
    forceFullHydration,
    needsEnrichment,
    startFullMarketFetch,
  ]);

  const resolvedCard = needsEnrichment ? enrichedCard : card;

  return {
    enrichedCard: resolvedCard,
    isLoadingCore: needsEnrichment ? isLoadingCore : false,
    isLoadingFull: needsEnrichment ? isLoadingFull : false,
    headlinePriceUsd: getHeadlineMarketPriceUsd(resolvedCard),
    priceConsensus: resolvedCard.priceConsensus,
    requestFullMarket,
  };
}
