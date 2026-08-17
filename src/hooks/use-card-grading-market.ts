"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cardHasPartialPreviewMarketData,
  cardNeedsGradingMarketEnrichment,
  sanitizePartialPreviewMarketCard,
} from "@/lib/grading-market-lookup";
import { buildGradingMarketParams } from "@/lib/grading-market-params";
import {
  getHeadlineMarketPriceUsd,
  isTrustedCatalogMarketPrice,
  shouldPreserveCatalogMarketPrice,
} from "@/lib/localized-set-market";
import { applyCanonicalJapaneseIdentityToCard } from "@/lib/japanese-market-identity";
import { isRealDatedSale } from "@/lib/market/market-history";
import {
  mergeLiveMarketHistory,
  mergeLiveRecentSales,
  shouldApplyLiveMarketPayload,
} from "@/lib/market/live-market-merge";
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
  JapaneseMarketIdentity,
  MarketConfidence,
  MarketEvidence,
  MarketHistorySummary,
  MarketSourceStatus,
  PopulationBreakdown,
  PriceConsensus,
  PricePoint,
  PsaPopulationSnapshot,
  SaleRecord,
  TcgCard,
} from "@/types/pokemon";

const LIVE_MARKET_TIMEOUT_MS = 5_000;
const LIVE_MARKET_ESCALATED_TIMEOUT_MS = 10_000;
const PREVIEW_MARKET_SOURCE =
  /static grail preview|bundled grail preview|premium preview composite|preview model|partial cached/i;

export type GradingMarketPayload = {
  timedOut?: boolean;
  status?: string;
  marketIdentity?: JapaneseMarketIdentity | null;
  psaPopulation: PsaPopulationSnapshot | null;
  gradedPrices: GradedPrice[];
  priceHistory: PricePoint[];
  marketHistory?: MarketHistorySummary;
  populationBreakdown?: PopulationBreakdown;
  recentSales: SaleRecord[];
  evidenceSummary?: EvidenceSummary;
  sourceStatus?: MarketSourceStatus[];
  marketEvidence?: MarketEvidence[];
  priceConsensus?: PriceConsensus;
  nmMarketUsd?: number | null;
};

function hasResolvedPopulationData(card: Pick<TcgCard, "psaPopulation">) {
  const population = card.psaPopulation;
  if (!population) {
    return false;
  }

  return (population.grades?.length ?? 0) > 0 || typeof population.totalCertified === "number";
}

function hasResolvedSlabValues(card: Pick<TcgCard, "gradedPrices">) {
  return (
    card.gradedPrices?.some((price) => price.grade !== "Ungraded" && price.value > 0) ?? false
  );
}

function shouldUseLivePopulation(
  live: PsaPopulationSnapshot | null | undefined,
  current: PsaPopulationSnapshot,
) {
  if (!live) {
    return false;
  }

  const currentIsPreview = PREVIEW_MARKET_SOURCE.test(
    `${current.source ?? ""} ${current.note ?? ""}`,
  );

  // Always replace homepage/static preview population once any live payload arrives,
  // even when the live snapshot is still pending — otherwise PSA 9/10-only fake
  // counts stay on screen forever.
  if (currentIsPreview) {
    return true;
  }

  return live.grades.length > 0 || typeof live.totalCertified === "number" || !current.grades.length;
}

function isPreviewPopulationSnapshot(snapshot: PsaPopulationSnapshot | null | undefined) {
  if (!snapshot) {
    return false;
  }

  return PREVIEW_MARKET_SOURCE.test(`${snapshot.source ?? ""} ${snapshot.note ?? ""}`);
}

function toLivePendingPopulation(
  current: PsaPopulationSnapshot,
  sourceStatus: MarketSourceStatus[] | undefined,
): PsaPopulationSnapshot {
  const populationStatus = sourceStatus?.find((status) => /population/i.test(status.source));

  return {
    ...current,
    status: "pending",
    totalCertified: null,
    grades: [],
    source: populationStatus?.source ?? "Live grading market",
    fetchedAt: populationStatus?.fetchedAt ?? new Date().toISOString(),
    note:
      populationStatus?.warning ??
      populationStatus?.note ??
      "Live grading lookup returned no population table for this card.",
    confidence: populationStatus?.confidence ?? "low",
    confidenceScore: populationStatus?.confidenceScore ?? 0.3,
    warning: populationStatus?.warning,
  };
}

function mergeLivePopulation(
  current: PsaPopulationSnapshot,
  live: PsaPopulationSnapshot | null | undefined,
  sourceStatus?: MarketSourceStatus[],
) {
  if (live) {
    return shouldUseLivePopulation(live, current) ? live : current;
  }

  return isPreviewPopulationSnapshot(current)
    ? toLivePendingPopulation(current, sourceStatus)
    : current;
}

function isPreviewGradedPrice(price: GradedPrice) {
  return PREVIEW_MARKET_SOURCE.test(`${price.source ?? ""} ${price.warning ?? ""}`);
}

function acceptedSaleCount(card: Pick<TcgCard, "recentSales">) {
  return (card.recentSales ?? []).filter(isRealDatedSale).length;
}

function mergeLiveGradedPrices(current: GradedPrice[], incoming: GradedPrice[] | undefined) {
  const currentWithoutPreview = (current ?? []).filter((price) => !isPreviewGradedPrice(price));

  if (!incoming?.length) {
    return currentWithoutPreview;
  }

  const byGrade = new Map(currentWithoutPreview.map((price) => [price.grade, price]));

  for (const price of incoming) {
    if (price.value > 0) {
      byGrade.set(price.grade, price);
    }
  }

  return [...byGrade.values()];
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
  current = applyCanonicalJapaneseIdentityToCard(current, data.marketIdentity);
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

  const nextMarketHistory = mergeLiveMarketHistory(current.marketHistory, data.marketHistory);
  const mergedCard: TcgCard = {
    ...current,
    psaPopulation: mergeLivePopulation(
      current.psaPopulation,
      data.psaPopulation,
      data.sourceStatus ?? data.evidenceSummary?.sourceStatus,
    ),
    marketPriceUsd: current.marketPriceUsd,
    gradedPrices: mergeLiveGradedPrices(current.gradedPrices, data.gradedPrices),
    priceHistory: nextHistory,
    marketHistory: nextMarketHistory,
    marketHistoryStatus: nextMarketHistory?.status ?? current.marketHistoryStatus,
    historyUnavailable: nextMarketHistory?.historyUnavailable ?? current.historyUnavailable,
    populationBreakdown: data.populationBreakdown ?? current.populationBreakdown,
    recentSales: mergeLiveRecentSales(current.recentSales ?? [], data.recentSales),
    evidenceSummary: data.evidenceSummary ?? current.evidenceSummary,
    sourceStatus: data.sourceStatus ?? data.evidenceSummary?.sourceStatus ?? current.sourceStatus,
    marketEvidence: data.marketEvidence ?? current.marketEvidence,
    priceConsensus: nextConsensus ?? current.priceConsensus,
    nmMarketUsd:
      typeof data.nmMarketUsd === "number" && data.nmMarketUsd > 0
        ? data.nmMarketUsd
        : current.nmMarketUsd,
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

  return syncUngradedToHeadline(mergedCard);
}

/**
 * Force the headline to a verified, block-resistant price from /api/price so the
 * grading-market consensus (which may be a stale/mismatched scrape) can't override
 * a trusted guide/sold figure. Population, graded values and the chart still come
 * from the grading-market payload.
 */
function applyPriceOverride(card: TcgCard, priceUsd: number): TcgCard {
  return syncUngradedToHeadline({
    ...card,
    marketPriceUsd: priceUsd,
    priceConsensus: card.priceConsensus
      ? { ...card.priceConsensus, finalEstimateUsd: priceUsd }
      : card.priceConsensus,
  });
}

function liveSoldCompCount(card: TcgCard) {
  return (card.recentSales ?? []).filter(
    (sale) =>
      !PREVIEW_MARKET_SOURCE.test(
        [sale.source, sale.listingUrl, sale.sourceUrl].filter(Boolean).join(" "),
      ),
  ).length;
}

function gradingMarketOutranksPriceApi(card: TcgCard) {
  const consensus = card.priceConsensus;
  const soldComps = liveSoldCompCount(card);
  const accepted = card.evidenceSummary?.accepted ?? 0;
  const soldCompSources =
    consensus?.sources?.filter((source) => source.evidenceType === "sold_comp") ?? [];
  const soldCompSamples = soldCompSources.reduce(
    (sum, source) => sum + (source.sampleCount ?? 0),
    0,
  );
  const hasSoldCompDepth = soldComps >= 3 || accepted >= 3 || soldCompSamples >= 3;

  if (hasSoldCompDepth && (consensus?.finalEstimateUsd ?? 0) > 0) {
    return true;
  }

  if (
    (consensus?.sourceCount ?? 0) >= 2 &&
    (consensus?.confidenceScore ?? 0) >= 0.55 &&
    (consensus?.finalEstimateUsd ?? 0) > 0
  ) {
    return true;
  }

  return false;
}

/** Keep raw headline, Ungraded grade row, and consensus on the same USD value. */
function syncUngradedToHeadline(card: TcgCard): TcgCard {
  const headline = getHeadlineMarketPriceUsd(card);

  if (!(headline > 0)) {
    return card;
  }

  let sawUngraded = false;
  const gradedPrices = card.gradedPrices.map((price) => {
    if (price.grade !== "Ungraded") {
      return price;
    }

    sawUngraded = true;
    return price.value === headline
      ? price
      : {
          ...price,
          value: headline,
        };
  });

  if (!sawUngraded) {
    gradedPrices.unshift({
      grade: "Ungraded",
      value: headline,
      populationCount: 0,
      service: "RAW",
      confidence: card.priceConsensus?.confidence ?? "medium",
      confidenceScore: card.priceConsensus?.confidenceScore,
      evidenceType: "guide_snapshot",
    });
  }

  return {
    ...card,
    marketPriceUsd: headline,
    gradedPrices,
    priceConsensus: card.priceConsensus
      ? {
          ...card.priceConsensus,
          finalEstimateUsd: headline,
        }
      : card.priceConsensus,
  };
}

function primaryPriceProviderResult(data: PriceLookupPayload): PriceLookupProviderResult | undefined {
  return (
    data.results?.find((result) => result.provider === data.primaryProvider) ??
    data.results?.find((result) => result.ungradedUsd && result.ungradedUsd > 0)
  );
}

function mergeRecentSales(current: SaleRecord[], incoming: SaleRecord[] | undefined) {
  if (!Array.isArray(incoming) || !incoming.length) {
    return current;
  }

  const byKey = new Map(
    (Array.isArray(current) ? current : []).map((sale) => [`${sale.date}:${sale.title}:${sale.price}`, sale]),
  );

  for (const sale of incoming) {
    byKey.set(`${sale.date}:${sale.title}:${sale.price}`, sale);
  }

  return [...byKey.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function applyVerifiedPricePayload(card: TcgCard, data: PriceLookupPayload, priceUsd: number): TcgCard {
  card = applyCanonicalJapaneseIdentityToCard(card, data.marketIdentity);
  if (typeof data.nmMarketUsd === "number" && data.nmMarketUsd > 0) {
    card = { ...card, nmMarketUsd: data.nmMarketUsd };
  }
  const providerResult = primaryPriceProviderResult(data);
  const isEstimate = isEstimatedPriceResult(data);
  const sourceName =
    providerResult?.sourceLabel ?? providerResult?.provider ?? data.primaryProvider ?? "Price API";
  const confidenceScore =
    data.confidenceScore ?? providerResult?.confidenceScore ?? card.priceConsensus?.confidenceScore ?? 0.5;
  const confidence: MarketConfidence =
    confidenceScore >= 0.72 ? "high" : confidenceScore >= 0.5 ? "medium" : "low";

  // When grading-market already produced sold-comp / multi-source consensus, only
  // attach the price API as supporting evidence. Replacing consensus here caused
  // one card to show three different raw prices (binder vs chart vs grade panel).
  if (gradingMarketOutranksPriceApi(card)) {
    const existingSources = card.priceConsensus?.sources ?? [];
    const withoutPriceApi = existingSources.filter((source) => source.source !== sourceName);
    const nextConsensus = card.priceConsensus
      ? {
          ...card.priceConsensus,
          sources: [
            ...withoutPriceApi,
            {
              source: sourceName,
              value: priceUsd,
              confidence,
              confidenceScore,
              evidenceType: providerResult?.evidenceType ?? "guide_snapshot",
              sampleCount: providerResult?.sampleCount,
              sourceUrl: providerResult?.sourceUrl,
              note: "Supporting price API snapshot; sold-comp / grading consensus remains primary.",
            },
          ],
          sourceCount: Math.max(card.priceConsensus.sourceCount, withoutPriceApi.length + 1),
        }
      : card.priceConsensus;

    return syncUngradedToHeadline({
      ...card,
      gradedPrices: mergeLiveGradedPrices(card.gradedPrices, providerResult?.gradedPrices),
      sourceStatus: [
        ...(card.sourceStatus ?? []).filter((status) => status.source !== sourceName),
        {
          source: sourceName,
          state: "ready",
          confidence,
          confidenceScore,
          note: "Supporting price API snapshot kept beside live grading-market evidence.",
          fetchedAt: data.fetchedAt ?? providerResult?.fetchedAt,
          sourceUrl: providerResult?.sourceUrl,
          sampleCount: providerResult?.sampleCount,
        },
      ],
      priceConsensus: nextConsensus,
    });
  }

  const nextCard: TcgCard = {
    ...card,
    marketPriceUsd: priceUsd,
    gradedPrices: mergeLiveGradedPrices(card.gradedPrices, providerResult?.gradedPrices),
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
        Math.max(
          providerResult?.sampleCount ?? 0,
          providerResult?.sales?.length ?? 0,
          card.evidenceSummary?.accepted ?? 0,
          1,
        ),
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

  return syncUngradedToHeadline(nextCard);
}

export function useCardGradingMarket(card: TcgCard) {
  const sanitizedCard = useMemo(() => sanitizePartialPreviewMarketCard(card), [card]);
  const needsEnrichment = cardNeedsGradingMarketEnrichment(sanitizedCard);
  // Restart enrichment only when market lookup identity changes — not when the
  // parent swaps an equivalent SSR/stashed card for the /api/cards payload.
  const marketLookupKey = useMemo(
    () =>
      [
        card.slug,
        buildPriceLookupParams(card).toString(),
        buildGradingMarketParams(card, "core").toString(),
        needsEnrichment ? "1" : "0",
      ].join("|"),
    [card, needsEnrichment],
  );
  const [enrichedState, setEnrichedState] = useState(() => ({
    sourceSlug: card.slug,
    card: sanitizedCard,
  }));
  const enrichedCard = enrichedState.sourceSlug === card.slug ? enrichedState.card : sanitizedCard;
  const [isLoadingCore, setIsLoadingCore] = useState(needsEnrichment);
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  // Verified price from /api/price, applied over the grading-market consensus.
  const priceOverrideRef = useRef(0);
  const pricePayloadRef = useRef<PriceLookupPayload | null>(null);
  const fullRequestedRef = useRef(false);
  const fullControllerRef = useRef<AbortController | null>(null);
  const marketCardRef = useRef(card);
  const sanitizedCardRef = useRef(sanitizedCard);
  const enrichedCardRef = useRef(sanitizedCard);

  useEffect(() => {
    marketCardRef.current = card;
    sanitizedCardRef.current = sanitizedCard;
  }, [card, sanitizedCard]);

  useEffect(() => {
    enrichedCardRef.current = enrichedCard;
  }, [enrichedCard]);

  const applyGradingData = useCallback((data: GradingMarketPayload | null, signal?: AbortSignal) => {
      if (!data || signal?.aborted || !shouldApplyLiveMarketPayload(data)) {
        return;
      }

      const activeCard = marketCardRef.current;
      const activeSanitizedCard = sanitizedCardRef.current;

      setEnrichedState((current) => {
        const currentCard =
          current.sourceSlug === activeCard.slug ? current.card : activeSanitizedCard;
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

        return {
          sourceSlug: activeCard.slug,
          card: merged,
        };
      });
    }, []);

  const fetchGradingPhase = useCallback(
    async (mode: "core" | "full", signal: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/grading-market?${buildGradingMarketParams(marketCardRef.current, mode).toString()}`,
          {
            cache: "no-store",
            signal,
          },
        );
        const data = (await response.json().catch(() => null)) as GradingMarketPayload | null;
        applyGradingData(data, signal);
        return data;
      } catch {
        return null;
      }
    },
    [applyGradingData],
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
      setIsLoadingCore(false);
    }, LIVE_MARKET_ESCALATED_TIMEOUT_MS);

    return fetchGradingPhase("full", controller.signal).finally(() => {
      if (!controller.signal.aborted) {
        setIsLoadingFull(false);
        setIsLoadingCore(false);
      }
      window.clearTimeout(timeoutId);
      if (fullControllerRef.current === controller) {
        fullControllerRef.current = null;
      }
    });
  }, [fetchGradingPhase]);

  const requestFullMarket = useCallback(() => {
    if (fullControllerRef.current) {
      return;
    }

    const currentSales = acceptedSaleCount(enrichedCardRef.current);
    if (fullRequestedRef.current && currentSales > 0) {
      return;
    }

    void startFullMarketFetch();
  }, [startFullMarketFetch]);

  useEffect(() => {
    priceOverrideRef.current = 0;
    pricePayloadRef.current = null;
    fullRequestedRef.current = false;
    fullControllerRef.current?.abort();
    fullControllerRef.current = null;

    queueMicrotask(() => {
      setIsLoadingFull(false);
    });

    return () => {
      fullControllerRef.current?.abort();
      fullControllerRef.current = null;
    };
  }, [card.slug]);

  useEffect(() => {
    const controller = new AbortController();
    const activeCard = marketCardRef.current;
    const activeSanitizedCard = sanitizedCardRef.current;
    const activeNeedsEnrichment = cardNeedsGradingMarketEnrichment(activeSanitizedCard);

    // Always allow a fresh full sold-comp pass for this enrichment cycle.
    // Leaving this latched true across same-slug card updates (stash → API)
    // was skipping full fetch and leaving sold comps / chart empty.
    fullRequestedRef.current = false;
    fullControllerRef.current?.abort();
    fullControllerRef.current = null;

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }

      // Always restart from the sanitized catalog payload so stashed/homepage
      // preview rows cannot remain visible while the new enrichment run starts.
      setEnrichedState({
        sourceSlug: activeCard.slug,
        card: activeSanitizedCard,
      });
      setIsLoadingCore(activeNeedsEnrichment);
      setIsLoadingFull(false);
    });

    if (!activeNeedsEnrichment) {
      if (acceptedSaleCount(activeSanitizedCard) < 2) {
        void startFullMarketFetch();
      }
      return () => controller.abort();
    }

    let activeTimeoutId = 0;
    const armLoadingTimeout = (ms: number) => {
      window.clearTimeout(activeTimeoutId);
      activeTimeoutId = window.setTimeout(() => {
        controller.abort();
        setIsLoadingCore(false);
      }, ms);
      return activeTimeoutId;
    };

    activeTimeoutId = window.setTimeout(() => {
      // Do not abort in-flight price/core lookups at 5s. That painted empty
      // READY / "No pop table" panels on grail cards like Umbreon VMAX #215.
      // Also do not start Magery here — it shares the PriceCharting host lock
      // with the in-flight core scrape.
      if (
        !hasResolvedPopulationData(enrichedCardRef.current) ||
        !hasResolvedSlabValues(enrichedCardRef.current)
      ) {
        armLoadingTimeout(LIVE_MARKET_ESCALATED_TIMEOUT_MS);
        return;
      }
      setIsLoadingCore(false);
    }, LIVE_MARKET_TIMEOUT_MS);

    const applyPriceData = (data: PriceLookupPayload | null) => {
      if (!data || controller.signal.aborted) {
        return;
      }

      if (data.marketIdentity) {
        setEnrichedState((current) => {
          const currentCard =
            current.sourceSlug === activeCard.slug ? current.card : activeSanitizedCard;
          return {
            sourceSlug: activeCard.slug,
            card: applyCanonicalJapaneseIdentityToCard(currentCard, data.marketIdentity),
          };
        });
      }

      if (!isVerifiedPriceResult(data)) {
        return;
      }

      const verifiedUsd = getPriceLookupUsd(data);
      if (!verifiedUsd) {
        return;
      }

      priceOverrideRef.current = verifiedUsd;
      pricePayloadRef.current = data;
      setEnrichedState((current) => {
        const currentCard =
          current.sourceSlug === activeCard.slug ? current.card : activeSanitizedCard;
        return {
          sourceSlug: activeCard.slug,
          card: applyVerifiedPricePayload(currentCard, data, verifiedUsd),
        };
      });
    };

    async function runStagedEnrichment() {
      const startSoldCompPassIfNeeded = (card?: TcgCard | null) => {
        if (acceptedSaleCount(card ?? enrichedCardRef.current) >= 2) {
          return;
        }
        if (fullRequestedRef.current || fullControllerRef.current) {
          return;
        }
        void startFullMarketFetch();
      };

      // Kick off price + core grading together. Same endpoints and merge rules as
      // before — only the wall-clock wait is shorter when both are required.
      const pricePromise = fetch(
        `/api/price?${buildPriceLookupParams(activeCard).toString()}`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      )
        .then(async (response) =>
          response.ok ? ((await response.json()) as PriceLookupPayload) : null,
        )
        .catch(() => null);

      const corePromise = fetchGradingPhase("core", controller.signal);
      void pricePromise.then((priceData) => {
        if (!controller.signal.aborted) {
          applyPriceData(priceData);
        }
      });

      let shouldAutoRunFull = false;
      let coreMissingPrimaryData = false;
      try {
        const corePayload = await corePromise;
        if (controller.signal.aborted) {
          startSoldCompPassIfNeeded();
          return;
        }

        const mergedCoreCard = corePayload && shouldApplyLiveMarketPayload(corePayload)
          ? (() => {
              let merged = mergeGradingMarketIntoCard(activeSanitizedCard, corePayload);

              if (priceOverrideRef.current > 0 && pricePayloadRef.current) {
                merged = applyVerifiedPricePayload(
                  merged,
                  pricePayloadRef.current,
                  priceOverrideRef.current,
                );
              } else if (priceOverrideRef.current > 0) {
                merged = applyPriceOverride(merged, priceOverrideRef.current);
              }
              return merged;
            })()
          : null;
        // Null/empty core payloads must escalate too. The previous `merged &&`
        // guard left the panel on a blank sanitized card after the first visit.
        coreMissingPrimaryData =
          !mergedCoreCard ||
          !hasResolvedPopulationData(mergedCoreCard) ||
          !hasResolvedSlabValues(mergedCoreCard);
        shouldAutoRunFull =
          cardHasPartialPreviewMarketData(activeCard) ||
          coreMissingPrimaryData ||
          acceptedSaleCount(mergedCoreCard ?? activeSanitizedCard) < 2;

        // Paint pop/slabs as soon as core has them. Missing sold comps keep the
        // comps row in loading via isLoadingFull — they must not hold the whole
        // market panel on the skeleton. Do not start Magery until core finishes;
        // the two scrapes share the PriceCharting host lock and starve pop lookup.
        if (coreMissingPrimaryData) {
          activeTimeoutId = armLoadingTimeout(LIVE_MARKET_ESCALATED_TIMEOUT_MS);
        } else {
          setIsLoadingCore(false);
        }
        if (shouldAutoRunFull) {
          startSoldCompPassIfNeeded(mergedCoreCard);
        }
      } finally {
        if (!controller.signal.aborted && !coreMissingPrimaryData) {
          setIsLoadingCore(false);
        }
      }
    }

    void runStagedEnrichment();

    return () => {
      window.clearTimeout(activeTimeoutId);
      controller.abort();
      fullControllerRef.current?.abort();
    };
  }, [fetchGradingPhase, marketLookupKey, startFullMarketFetch]);

  const resolvedCard = enrichedCard;

  return {
    enrichedCard: resolvedCard,
    isLoadingCore: needsEnrichment ? isLoadingCore : false,
    isLoadingFull,
    headlinePriceUsd: getHeadlineMarketPriceUsd(resolvedCard),
    priceConsensus: resolvedCard.priceConsensus,
    requestFullMarket,
  };
}
