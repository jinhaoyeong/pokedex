"use client";

import { useEffect, useMemo, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { SearchSelect } from "@/components/search/search-select";
import { useManagedCardGradingMarket } from "@/components/card/card-grading-market-context";
import { PriceChart } from "@/components/card/price-chart";
import { buildGradingMarketParams } from "@/lib/grading-market-params";
import { getAppScrollRoot, isMobileAppShell } from "@/lib/app-scroll";
import {
  getHeadlineMarketPriceUsd,
  isTrustedCatalogMarketPrice,
  shouldPreserveCatalogMarketPrice,
} from "@/lib/localized-set-market";
import { usesEnglishParallelPsaPopulation } from "@/lib/psa-population-attribution";
import { readSettings } from "@/lib/settings-store";
import type {
  EvidenceSummary,
  GradedPrice,
  MarketConfidence,
  MarketEvidence,
  MarketSourceStatus,
  PricePoint,
  PriceConsensus,
  PsaPopulationSnapshot,
  SaleRecord,
  TcgCard,
} from "@/types/pokemon";

const GRADER_FAMILIES = ["All", "Ungraded", "PSA", "BGS", "CGC", "TAG", "SGC"] as const;
const POPULATION_GRADER_FILTERS = ["all", "psa", "cgc"] as const;
const LIVE_MARKET_TIMEOUT_MS = 45_000;
const ALL_SALES_FILTER = "All";
const FEATURED_GRADE_LIMIT = 4;

type PopulationGraderFilter = (typeof POPULATION_GRADER_FILTERS)[number];

type DisplayPopulationGrade = PsaPopulationSnapshot["grades"][number];

function parsePopulationGradeNumber(gradeLabel: string) {
  const match = gradeLabel.match(/(\d+(?:\.\d+)?)$/);
  return match ? match[1] : null;
}

function aggregatePopulationGrades(
  grades: PsaPopulationSnapshot["grades"],
  filter: PopulationGraderFilter,
): DisplayPopulationGrade[] {
  if (filter === "psa") {
    return grades.filter(
      (grade) => grade.grade.startsWith("PSA ") && !grade.grade.includes("+"),
    );
  }

  if (filter === "cgc") {
    return grades.filter((grade) => grade.grade.startsWith("CGC "));
  }

  const byGrade = new Map<string, { psa: number; cgc: number }>();

  for (const grade of grades) {
    const gradeNumber = parsePopulationGradeNumber(grade.grade);

    if (!gradeNumber) {
      continue;
    }

    const entry = byGrade.get(gradeNumber) ?? { psa: 0, cgc: 0 };

    if (grade.grade.startsWith("PSA+CGC ")) {
      entry.cgc += grade.count;
    } else if (grade.grade.startsWith("PSA ")) {
      entry.psa += grade.count;
    } else if (grade.grade.startsWith("CGC ")) {
      entry.cgc += grade.count;
    }

    byGrade.set(gradeNumber, entry);
  }

  return [...byGrade.entries()]
    .sort((left, right) => Number(right[0]) - Number(left[0]))
    .map(([gradeNumber, counts]) => {
      const total = counts.psa + counts.cgc;
      const label =
        counts.psa > 0 && counts.cgc > 0
          ? `PSA+CGC ${gradeNumber}`
          : counts.psa > 0
            ? `PSA ${gradeNumber}`
            : `CGC ${gradeNumber}`;

      return {
        grade: label,
        count: total,
        service: counts.psa > 0 && counts.cgc > 0 ? undefined : counts.psa > 0 ? "PSA" : "CGC",
        confidence: "medium" as const,
        confidenceScore: counts.psa > 0 && counts.cgc > 0 ? 0.66 : counts.psa > 0 ? 0.72 : 0.68,
        evidenceType: "population" as const,
      };
    });
}

function getFilteredPopulationTotal(
  grades: PsaPopulationSnapshot["grades"],
  filter: PopulationGraderFilter,
  snapshotTotal: number | null | undefined,
) {
  const filtered = aggregatePopulationGrades(grades, filter);
  const sum = filtered.reduce((total, grade) => total + grade.count, 0);

  if (sum > 0) {
    return sum;
  }

  return filter === "all" ? snapshotTotal ?? null : null;
}

function populationGraderFilterLabel(filter: PopulationGraderFilter) {
  if (filter === "psa") {
    return "PSA";
  }

  if (filter === "cgc") {
    return "CGC";
  }

  return "All";
}

function getGradeFamily(grade: string) {
  if (grade === "Ungraded") {
    return "Ungraded";
  }

  if (grade.startsWith("PSA")) return "PSA";
  if (grade.startsWith("BGS") || grade.startsWith("BECKETT")) return "BGS";
  if (grade.startsWith("CGC")) return "CGC";
  if (grade.startsWith("TAG")) return "TAG";
  if (grade.startsWith("SGC")) return "SGC";
  return "Other";
}

function getDefaultGrade(card: TcgCard) {
  return card.gradedPrices.find((price) => price.grade === "Ungraded")?.grade ?? card.gradedPrices[0]?.grade ?? "Ungraded";
}

function compareSales(left: SaleRecord, right: SaleRecord) {
  return right.date.localeCompare(left.date);
}

function mergePriceHistory(catalog: PricePoint[], live: PricePoint[]) {
  if (!live.length) {
    return catalog;
  }

  if (!catalog.length) {
    return live;
  }

  const byDate = new Map<string, PricePoint>();

  for (const point of catalog) {
    byDate.set(point.date, {
      ...point,
      gradeValues: point.gradeValues ? { ...point.gradeValues } : undefined,
    });
  }

  for (const point of live) {
    const existing = byDate.get(point.date);

    if (!existing) {
      byDate.set(point.date, {
        ...point,
        gradeValues: point.gradeValues ? { ...point.gradeValues } : undefined,
      });
      continue;
    }

    byDate.set(point.date, {
      ...existing,
      value: point.value > 0 ? point.value : existing.value,
      gradeValues: {
        ...(existing.gradeValues ?? {}),
        ...(point.gradeValues ?? {}),
      },
      isProjected: existing.isProjected || point.isProjected,
    });
  }

  return [...byDate.values()].sort((left, right) => {
    const leftTime = Date.parse(left.date);
    const rightTime = Date.parse(right.date);

    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
      return leftTime - rightTime;
    }

    return left.date.localeCompare(right.date);
  });
}

function shouldUseLivePopulation(
  live: PsaPopulationSnapshot | null,
  current: PsaPopulationSnapshot,
) {
  if (!live) {
    return false;
  }

  return live.grades.length > 0 || typeof live.totalCertified === "number" || !current.grades.length;
}

function getPopulationTotalLabel(
  card: TcgCard,
  isLoadingLiveMarket: boolean,
) {
  const snapshot = card.psaPopulation;

  if (typeof snapshot.totalCertified === "number") {
    return snapshot.totalCertified.toLocaleString();
  }

  if (isLoadingLiveMarket) {
    return "Checking";
  }

  return hasMarketFallbackEvidence(card) ? "Evidence only" : "Unavailable";
}

function hasPopulationSignal(snapshot: PsaPopulationSnapshot) {
  return snapshot.grades.length > 0 || typeof snapshot.totalCertified === "number";
}

function hasMarketFallbackEvidence(card: TcgCard) {
  return (
    (card.evidenceSummary?.accepted ?? 0) > 0 ||
    (card.recentSales?.length ?? 0) > 0 ||
    card.gradedPrices.some((price) => price.value > 0 && price.grade !== "Ungraded") ||
    Boolean(card.priceConsensus)
  );
}

function getPopulationSourceSummary(snapshot: PsaPopulationSnapshot) {
  const source = snapshot.source?.trim() || "Unknown source";
  const confidence = snapshot.confidence ?? "medium";
  const confidencePercent =
    typeof snapshot.confidenceScore === "number"
      ? `${Math.round(snapshot.confidenceScore * 100)}%`
      : null;

  return {
    source,
    confidence,
    confidencePercent,
    isEnglishParallelEstimate:
      usesEnglishParallelPsaPopulation(snapshot) ||
      /english parallel/i.test(`${snapshot.warning ?? ""} ${snapshot.note ?? ""} ${snapshot.source ?? ""}`),
    isCombinedEstimate: /psa\+cgc|combined/i.test(`${snapshot.warning ?? ""} ${snapshot.note ?? ""}`),
  };
}

function getPopulationReportConfidence(card: TcgCard): MarketConfidence {
  if (hasPopulationSignal(card.psaPopulation)) {
    return card.psaPopulation.confidence ?? "medium";
  }

  if (card.priceConsensus?.confidence) {
    return card.priceConsensus.confidence;
  }

  const accepted = card.evidenceSummary?.accepted ?? card.recentSales?.length ?? 0;
  const activeSource = (card.sourceStatus ?? card.evidenceSummary?.sourceStatus ?? []).find(
    (status) =>
      (status.state === "ready" || status.state === "fallback" || status.state === "cached") &&
      status.confidence !== "low",
  );

  if (accepted >= 6 || activeSource) {
    return "medium";
  }

  return "low";
}

function getPopulationFallbackStats(card: TcgCard) {
  const accepted = card.evidenceSummary?.accepted ?? card.recentSales?.length ?? 0;
  const gradeRefs = card.gradedPrices.filter(
    (price) => price.grade !== "Ungraded" && price.value > 0,
  ).length;
  const activeSources = (
    card.sourceStatus ??
    card.evidenceSummary?.sourceStatus ??
    []
  ).filter((status) =>
    status.state === "ready" || status.state === "fallback" || status.state === "cached",
  ).length;

  return [
    { label: "Accepted comps", value: accepted },
    { label: "Grade refs", value: gradeRefs },
    { label: "Active sources", value: activeSources },
  ].filter((item) => item.value > 0);
}

function priceOptionLabel(price: GradedPrice) {
  return `${price.grade} / ${price.confidence ?? "low"} trust`;
}

function getEvidenceLabel(price: GradedPrice) {
  if (price.saleCount && price.saleCount > 0) {
    return `${price.saleCount} accepted sale${price.saleCount === 1 ? "" : "s"}`;
  }

  if (price.populationCount > 0) {
    return `Pop ${price.populationCount.toLocaleString()}`;
  }

  if (price.evidenceType === "guide_snapshot") {
    return "Guide snapshot";
  }

  return price.grade === "Ungraded" ? "Raw market estimate" : "Reference estimate";
}

function getGradeSortScore(price: GradedPrice) {
  const confidenceScore =
    price.confidenceScore ??
    (price.confidence === "high" ? 0.9 : price.confidence === "medium" ? 0.6 : 0.3);
  const saleScore = Math.min(price.saleCount ?? 0, 12) / 12;
  const populationScore = price.populationCount > 0 ? 0.1 : 0;

  return confidenceScore * 10 + saleScore * 4 + populationScore;
}

function getFeaturedGrades(prices: GradedPrice[], selectedGrade: string) {
  const preferredGrades = [selectedGrade, "Ungraded", "PSA 10", "PSA 9", "BGS 10", "CGC 10"];
  const featured = new Map<string, GradedPrice>();

  for (const grade of preferredGrades) {
    const price = prices.find((item) => item.grade === grade);

    if (price) {
      featured.set(price.grade, price);
    }
  }

  for (const price of [...prices].sort((left, right) => getGradeSortScore(right) - getGradeSortScore(left))) {
    if (featured.size >= FEATURED_GRADE_LIMIT) {
      break;
    }

    featured.set(price.grade, price);
  }

  return [...featured.values()].slice(0, FEATURED_GRADE_LIMIT);
}

function confidenceClass(confidence?: string) {
  if (confidence === "high") return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
  if (confidence === "medium") return "status-badge--medium";
  return "border-amber-300/35 bg-amber-400/10 text-amber-100";
}

function sourceStateClass(state?: MarketSourceStatus["state"]) {
  if (state === "ready" || state === "cached") {
    return "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";
  }
  if (state === "fallback") {
    return "status-badge--medium";
  }
  if (state === "missing_credentials" || state === "disabled") {
    return "border-slate-400/25 bg-white/5 text-slate-300";
  }
  return "border-amber-300/35 bg-amber-400/10 text-amber-100";
}

function sourceStateLabel(state?: MarketSourceStatus["state"]) {
  if (state === "missing_credentials") return "Needs key";
  if (state === "no_match") return "No match";
  return state ?? "unknown";
}

export function GradedMarketPanel({
  card,
  liveMarketPrefetched = false,
  managedMarket,
}: {
  card: TcgCard;
  liveMarketPrefetched?: boolean;
  managedMarket?: {
    isLoadingLiveMarket: boolean;
    isLoadingFullMarket?: boolean;
  };
}) {
  const sharedMarket = useManagedCardGradingMarket();
  const usesSharedMarket = Boolean(sharedMarket || managedMarket);
  const [liveCard, setLiveCard] = useState(card);
  const [isLoadingLiveMarket, setIsLoadingLiveMarket] = useState(
    () => !(liveMarketPrefetched || usesSharedMarket),
  );
  const [selectedGrade, setSelectedGrade] = useState<string>(getDefaultGrade(card));
  const [selectedFamily, setSelectedFamily] = useState<string>(
    () => readSettings().defaultGradeFamily,
  );
  const [populationGraderFilter, setPopulationGraderFilter] =
    useState<PopulationGraderFilter>("all");
  const [isGradePickerOpen, setIsGradePickerOpen] = useState(false);
  const [salesFilter, setSalesFilter] = useState<string>(ALL_SALES_FILTER);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const displayCard = sharedMarket?.enrichedCard ?? liveCard;
  const resolvedLoadingLiveMarket =
    managedMarket?.isLoadingLiveMarket ?? sharedMarket?.isLoadingCore ?? isLoadingLiveMarket;

  useEffect(() => {
    if (sharedMarket || managedMarket) {
      return;
    }

    if (liveMarketPrefetched && hasPopulationSignal(card.psaPopulation)) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      setIsLoadingLiveMarket(false);
    }, LIVE_MARKET_TIMEOUT_MS);
    type GradingMarketResponse = {
      psaPopulation: PsaPopulationSnapshot | null;
      gradedPrices: GradedPrice[];
      priceHistory: PricePoint[];
      recentSales: SaleRecord[];
      evidenceSummary?: EvidenceSummary;
      sourceStatus?: MarketSourceStatus[];
      marketEvidence?: MarketEvidence[];
      priceConsensus?: PriceConsensus;
    };

    const applyData = (data: GradingMarketResponse | null) => {
      if (!data || controller.signal.aborted) {
        return;
      }

      setLiveCard((current) => {
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
      });
    };

    const fetchPhase = (mode: "core" | "full") =>
      fetch(`/api/grading-market?${buildGradingMarketParams(card, mode).toString()}`, {
        signal: controller.signal,
      })
        .then((response) => response.json().catch(() => null) as Promise<GradingMarketResponse | null>)
        .then(applyData)
        .catch(() => undefined);

    // Stage 1: fast core (price, population, graded values) clears the loading state quickly.
    fetchPhase("core").finally(() => {
      if (!controller.signal.aborted) {
        setIsLoadingLiveMarket(false);
      }
    });
    // Stage 2: sold comps and refined consensus load in the background.
    fetchPhase("full").finally(() => {
      window.clearTimeout(timeoutId);
    });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [card, liveMarketPrefetched, managedMarket, sharedMarket]);

  useEffect(() => {
    if (!isSalesModalOpen) {
      return;
    }

    const scrollRoot = getAppScrollRoot();
    const useAppShellScroll = isMobileAppShell() && scrollRoot;
    const scrollY = useAppShellScroll ? scrollRoot.scrollTop : window.scrollY;
    const bodyStyle = document.body.style;
    const htmlStyle = document.documentElement.style;
    const scrollRootStyle = scrollRoot?.style;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousBodyPosition = bodyStyle.position;
    const previousBodyTop = bodyStyle.top;
    const previousBodyWidth = bodyStyle.width;
    const previousHtmlOverflow = htmlStyle.overflow;
    const previousScrollRootOverflow = scrollRootStyle?.overflow ?? "";

    if (useAppShellScroll && scrollRootStyle) {
      scrollRootStyle.overflow = "hidden";
    } else {
      htmlStyle.overflow = "hidden";
      bodyStyle.overflow = "hidden";
      bodyStyle.position = "fixed";
      bodyStyle.top = `-${scrollY}px`;
      bodyStyle.width = "100%";
    }

    return () => {
      if (useAppShellScroll && scrollRoot) {
        scrollRoot.style.overflow = previousScrollRootOverflow;
        scrollRoot.scrollTo(0, scrollY);
      } else {
        htmlStyle.overflow = previousHtmlOverflow;
        bodyStyle.overflow = previousBodyOverflow;
        bodyStyle.position = previousBodyPosition;
        bodyStyle.top = previousBodyTop;
        bodyStyle.width = previousBodyWidth;
        window.scrollTo(0, scrollY);
      }
    };
  }, [isSalesModalOpen]);

  const visibleGrades = useMemo(() => {
    if (selectedFamily === "All") {
      return displayCard.gradedPrices;
    }

    return displayCard.gradedPrices.filter((price) => getGradeFamily(price.grade) === selectedFamily);
  }, [displayCard.gradedPrices, selectedFamily]);

  const activeSelectedGrade =
    visibleGrades.find((price) => price.grade === selectedGrade)?.grade ??
    visibleGrades[0]?.grade ??
    selectedGrade;

  const selectedPrice = useMemo(
    () => displayCard.gradedPrices.find((price) => price.grade === activeSelectedGrade),
    [activeSelectedGrade, displayCard.gradedPrices],
  );
  const featuredGrades = useMemo(
    () => getFeaturedGrades(visibleGrades, activeSelectedGrade),
    [activeSelectedGrade, visibleGrades],
  );
  const additionalGrades = useMemo(() => {
    const featuredGradeNames = new Set(featuredGrades.map((price) => price.grade));

    return visibleGrades.filter((price) => !featuredGradeNames.has(price.grade));
  }, [featuredGrades, visibleGrades]);
  const hiddenGradeCount = additionalGrades.length;

  const sourceStatuses =
    displayCard.sourceStatus ?? displayCard.evidenceSummary?.sourceStatus ?? [];
  const populationHasSignal = hasPopulationSignal(displayCard.psaPopulation);
  const populationSourceSummary = getPopulationSourceSummary(displayCard.psaPopulation);
  const populationReportConfidence = getPopulationReportConfidence(displayCard);
  const populationFallbackStats = getPopulationFallbackStats(displayCard);
  const filteredPopulationGrades = useMemo(
    () => aggregatePopulationGrades(displayCard.psaPopulation.grades, populationGraderFilter),
    [displayCard.psaPopulation.grades, populationGraderFilter],
  );
  const filteredPopulationTotal = useMemo(
    () =>
      getFilteredPopulationTotal(
        displayCard.psaPopulation.grades,
        populationGraderFilter,
        displayCard.psaPopulation.totalCertified,
      ),
    [
      displayCard.psaPopulation.grades,
      displayCard.psaPopulation.totalCertified,
      populationGraderFilter,
    ],
  );

  const saleFilterOptions = useMemo(() => {
    const conditions = [
      ALL_SALES_FILTER,
      activeSelectedGrade,
      "Ungraded",
      ...displayCard.gradedPrices.map((price) => price.grade),
      ...(displayCard.recentSales ?? []).map((sale) => sale.condition),
    ];

    return conditions.filter(
      (condition, index) => condition && conditions.indexOf(condition) === index,
    );
  }, [activeSelectedGrade, displayCard.gradedPrices, displayCard.recentSales]);

  const requestedSalesFilter =
    salesFilter === ALL_SALES_FILTER || saleFilterOptions.includes(salesFilter)
      ? salesFilter
      : activeSelectedGrade;

  const allSales = useMemo(
    () => [...(displayCard.recentSales ?? [])].sort(compareSales),
    [displayCard.recentSales],
  );

  const filteredSales = useMemo(
    () =>
      requestedSalesFilter === ALL_SALES_FILTER
        ? allSales
        : allSales.filter((sale) => sale.condition === requestedSalesFilter),
    [requestedSalesFilter, allSales],
  );
  const shouldShowAllSalesFallback = requestedSalesFilter !== ALL_SALES_FILTER && !filteredSales.length && allSales.length > 0;
  const activeSalesFilter = shouldShowAllSalesFallback ? ALL_SALES_FILTER : requestedSalesFilter;
  const sales = shouldShowAllSalesFallback ? allSales : filteredSales;

  return (
    <>
    <div className="grid items-start gap-2 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)]">
        <article id="graded-prices" className="glass-card order-1 flex flex-col rounded-2xl p-4 sm:p-5 xl:sticky xl:top-4 xl:col-start-2 xl:row-start-1">
          <div className="min-h-[3.25rem]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Grade values
            </p>
            <h2 className="mt-0.5 font-[var(--font-game-copy)] text-base font-semibold leading-tight text-white sm:text-lg">
              {activeSelectedGrade}
            </h2>
          </div>

          <div className="mt-3 space-y-3">
            <div className="segment-control flex-wrap gap-1.5 sm:gap-2">
              {GRADER_FAMILIES.filter((family) => {
                if (family === "All") {
                  return true;
                }

                return displayCard.gradedPrices.some((price) => getGradeFamily(price.grade) === family);
              }).map((family) => (
                <button
                  key={family}
                  type="button"
                  onClick={() => setSelectedFamily(family)}
                  className={`segment-btn ${
                    selectedFamily === family ? "segment-btn--active" : ""
                  }`}
                >
                  {family}
                </button>
              ))}
            </div>

            {visibleGrades.length ? (
              <div className="space-y-3 sm:space-y-4">
                <SearchSelect
                  name="gradeValue"
                  ariaLabel="Select grade value"
                  value={activeSelectedGrade}
                  options={visibleGrades.map((price) => ({
                    value: price.grade,
                    label: priceOptionLabel(price),
                  }))}
                  onChange={setSelectedGrade}
                />

                {selectedPrice ? (
                  <div className="accent-callout">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 sm:gap-3">
                      <div className="min-w-0">
                        <p className="accent-callout-label sm:text-xs sm:tracking-[0.1em]">
                          Selected
                        </p>
                        <p className="accent-callout-value mt-1 break-words text-base font-semibold leading-snug sm:text-lg">
                          {selectedPrice.grade}
                        </p>
                      </div>
                      <ClientPrice
                        amountUsd={selectedPrice.value}
                        className="accent-callout-value min-w-0 break-words text-right text-lg font-semibold sm:text-xl"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs leading-5 text-slate-300 sm:mt-3 sm:gap-2 sm:text-sm">
                      <span>{getEvidenceLabel(selectedPrice)}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] sm:px-2.5 sm:py-1 sm:text-[11px] sm:tracking-[0.1em] ${confidenceClass(selectedPrice.confidence)}`}
                      >
                        {selectedPrice.confidence ?? "low"}
                      </span>
                      {selectedPrice.warning ? (
                        <span className="rounded-full border border-amber-300/25 bg-amber-400/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-100 sm:px-2.5 sm:py-1 sm:text-[11px] sm:tracking-[0.1em]">
                          Thin evidence
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="overflow-hidden rounded-xl border border-white/10 bg-white/4">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(4.75rem,auto)_minmax(3.35rem,auto)] gap-1.5 border-b border-white/10 px-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.07em] text-slate-400 sm:grid-cols-[minmax(0,1.1fr)_minmax(6.4rem,auto)_minmax(4.8rem,auto)] sm:gap-2 sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.09em]">
                    <span>Grade</span>
                    <span className="text-right">Value</span>
                    <span className="text-right">Trust</span>
                  </div>
                  <div className="divide-y divide-white/8">
                    {featuredGrades.map((price) => {
                      const isSelected = price.grade === activeSelectedGrade;

                      return (
                        <button
                          key={price.grade}
                          type="button"
                          onClick={() => setSelectedGrade(price.grade)}
                          className={`grid min-h-[3.25rem] w-full grid-cols-[minmax(0,1fr)_minmax(4.75rem,auto)_minmax(3.35rem,auto)] items-center gap-1.5 px-2.5 py-2 text-left transition sm:min-h-[4.25rem] sm:grid-cols-[minmax(0,1.1fr)_minmax(6.4rem,auto)_minmax(4.8rem,auto)] sm:gap-2 sm:px-4 sm:py-3 ${
                            isSelected
                              ? "row-selected"
                              : "bg-slate-950/20 hover:bg-white/5"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="break-words text-[13px] font-semibold leading-snug text-white sm:text-sm">{price.grade}</p>
                            <p className="mt-1 hidden break-words text-xs leading-snug text-slate-400 sm:block">{getEvidenceLabel(price)}</p>
                          </div>
                          <ClientPrice
                            amountUsd={price.value}
                            className={`min-w-0 break-words text-right text-[13px] font-semibold sm:text-base ${isSelected ? "text-[var(--text)]" : "text-white"}`}
                          />
                          <span
                            className={`justify-self-end rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] sm:px-2 sm:py-1 sm:text-[11px] sm:tracking-[0.08em] ${confidenceClass(price.confidence)}`}
                          >
                            {price.confidence ?? "low"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {hiddenGradeCount > 0 ? (
                  <div className="hidden sm:block">
                    <button
                      type="button"
                      onClick={() => setIsGradePickerOpen((value) => !value)}
                      className="btn btn-ghost btn-sm w-full"
                    >
                      {isGradePickerOpen
                        ? "Hide additional grades"
                        : `Show ${hiddenGradeCount.toLocaleString()} more grade${hiddenGradeCount === 1 ? "" : "s"}`}
                    </button>
                    {isGradePickerOpen ? (
                      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/45 p-2">
                        <div className="grid gap-2">
                          {additionalGrades.map((price) => {
                            const isSelected = price.grade === activeSelectedGrade;

                            return (
                              <button
                                key={price.grade}
                                type="button"
                                onClick={() => setSelectedGrade(price.grade)}
                                className={`grid min-h-11 grid-cols-[minmax(0,1.1fr)_minmax(6.4rem,auto)_minmax(4.8rem,auto)] items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                                  isSelected
                                    ? "row-selected text-[var(--text)]"
                                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                                }`}
                              >
                                <span className="truncate">{price.grade}</span>
                                <ClientPrice amountUsd={price.value} className="text-right font-semibold" />
                                <span className="justify-self-end text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                                  {price.confidence ?? "low"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {!visibleGrades.length ? (
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3.5 text-sm leading-6 text-amber-100">
                No {selectedFamily} grades are available for this card yet.
              </div>
            ) : null}
          </div>

          {displayCard.evidenceSummary ? (
            <div className="mt-3 hidden grid-cols-2 gap-2 text-sm text-slate-300 sm:mt-4 sm:grid sm:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-white/4 p-3">
                <p className="text-slate-500">Accepted</p>
                <p className="mt-1 font-semibold text-white">{displayCard.evidenceSummary.accepted}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/4 p-3">
                <p className="text-slate-500">Rejected</p>
                <p className="mt-1 font-semibold text-white">{displayCard.evidenceSummary.rejected}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/4 p-3">
                <p className="text-slate-500">Thin</p>
                <p className="mt-1 font-semibold text-white">{displayCard.evidenceSummary.thin}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/4 p-3">
                <p className="text-slate-500">Fallback</p>
                <p className="mt-1 font-semibold text-white">{displayCard.evidenceSummary.fallback}</p>
              </div>
            </div>
          ) : null}

          <div className="mt-auto border-t border-white/10 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-[var(--font-game-copy)] text-sm font-semibold text-white sm:text-base">
                  Sold comps
                </h2>
                <p className="mt-0.5 text-xs leading-5 text-slate-400">
                  {allSales.length
                    ? `${allSales.length} accepted comp${allSales.length === 1 ? "" : "s"}`
                    : "None available yet"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSalesModalOpen(true)}
                disabled={!allSales.length}
                className="btn btn-ghost btn-sm"
              >
                Open
              </button>
            </div>
          </div>
        </article>

        <article className="glass-card order-2 rounded-2xl p-4 sm:p-5 xl:col-start-1 xl:row-start-1">
        <PriceChart
          embedded
          points={displayCard.priceHistory}
          selectedGrade={activeSelectedGrade}
          snapshotAmountUsd={selectedPrice?.value}
          gradedPrices={displayCard.gradedPrices}
          visibleGradeLabels={visibleGrades.map((price) => price.grade)}
          onSelectGrade={setSelectedGrade}
        />
        </article>

        <article className="glass-card order-3 rounded-2xl p-4 sm:p-5 xl:col-start-1 xl:row-start-2">
          <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                <div className="min-w-0">
                  <h2 className="font-[var(--font-game-copy)] text-base font-semibold text-white sm:text-lg">
                    Population
                  </h2>
                  {populationHasSignal ? (
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      Source: {populationSourceSummary.source}
                      {populationSourceSummary.confidencePercent
                        ? ` · ${populationSourceSummary.confidence} (${populationSourceSummary.confidencePercent})`
                        : ` · ${populationSourceSummary.confidence}`}
                    </p>
                  ) : null}
                </div>
                {populationHasSignal && displayCard.psaPopulation.grades.length ? (
                  <div
                    className="chip-segment"
                    role="group"
                    aria-label="Population grader filter"
                  >
                    {POPULATION_GRADER_FILTERS.map((filter) => {
                      const isActive = populationGraderFilter === filter;

                      return (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setPopulationGraderFilter(filter)}
                          className={`chip-btn sm:text-[11px] sm:tracking-[0.1em] ${
                            isActive ? "chip-btn--active" : ""
                          }`}
                          aria-pressed={isActive}
                        >
                          {populationGraderFilterLabel(filter)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {sourceStatuses.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-2.5 sm:gap-2">
                  {sourceStatuses.slice(0, 6).map((status) => (
                    <span
                      key={`${status.source}-${status.state}`}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] sm:px-2.5 sm:py-1 sm:text-[11px] sm:tracking-[0.1em] ${sourceStateClass(status.state)}`}
                    >
                      {sourceStateLabel(status.state)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-400 sm:text-xs sm:tracking-[0.11em]">Total</p>
              <p className="mt-1 whitespace-nowrap text-xl font-semibold leading-none text-white sm:text-2xl">
                {typeof filteredPopulationTotal === "number"
                  ? filteredPopulationTotal.toLocaleString()
                  : getPopulationTotalLabel(displayCard, resolvedLoadingLiveMarket)}
              </p>
              <span
                className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] sm:mt-2 sm:px-2.5 sm:py-1 sm:text-[11px] sm:tracking-[0.1em] ${confidenceClass(populationReportConfidence)}`}
              >
                {populationReportConfidence} trust
              </span>
            </div>
          </div>

          {populationSourceSummary.isEnglishParallelEstimate ? (
            <div className="mt-3 rounded-xl border border-sky-400/25 bg-sky-400/10 px-3 py-2.5 text-xs leading-5 text-sky-100 sm:text-sm">
              {displayCard.psaPopulation.warning ??
                "PSA population reflects the English parallel release because Japanese PSA submissions are minimal in public census data."}
            </div>
          ) : populationSourceSummary.isCombinedEstimate ? (
            <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-100 sm:text-sm">
              {displayCard.psaPopulation.warning ??
                "Set-index population rows combine PSA and CGC counts for grades 6-10."}
            </div>
          ) : null}

          {populationHasSignal && filteredPopulationGrades.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-2.5 lg:grid-cols-3">
              {filteredPopulationGrades.map((grade) => (
                <div
                  key={grade.grade}
                  className="flex min-h-10 items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/4 px-2.5 py-2 sm:min-h-12 sm:gap-3 sm:px-3.5 sm:py-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white sm:text-sm">{grade.grade}</p>
                    {grade.confidence ? (
                      <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                        {grade.confidence} confidence
                      </p>
                    ) : null}
                  </div>
                  <p className="text-sm font-semibold text-blue-300 sm:text-base">{grade.count.toLocaleString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-sm leading-5 text-amber-100 sm:mt-4 sm:px-3.5 sm:py-3 sm:leading-6">
              {resolvedLoadingLiveMarket ? (
                "Checking population sources..."
              ) : hasMarketFallbackEvidence(displayCard) ? (
                "No certified population table was exposed by the public sources, but market evidence did load. Treat the figures below as comps and reference snapshots, not official population counts."
              ) : (
                "No public population table found yet."
              )}
              {!resolvedLoadingLiveMarket && populationFallbackStats.length ? (
                <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:mt-3 sm:gap-2">
                  {populationFallbackStats.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border border-amber-300/20 bg-slate-950/35 px-2 py-1.5 sm:px-3 sm:py-2"
                    >
                      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-amber-200/80 sm:text-[10px] sm:tracking-[0.1em]">
                        {item.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white sm:text-base">
                        {item.value.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

        </article>
    </div>

      {isSalesModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/78 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sold-comps-title"
        >
          <div className="glass-card flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border border-white/10 sm:h-auto sm:max-h-[90vh] sm:max-w-5xl sm:rounded-2xl">
            <div className="flex shrink-0 flex-col gap-3 border-b border-white/10 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6 sm:py-5">
              <div className="min-w-0">
                <h3 id="sold-comps-title" className="font-[var(--font-game-copy)] text-xl font-semibold leading-tight text-white sm:text-2xl">Last sold listings</h3>
                <p className="mt-1.5 text-sm leading-5 text-slate-300 sm:mt-2 sm:leading-6">
                  Showing {activeSalesFilter === ALL_SALES_FILTER ? "all accepted comps" : activeSalesFilter}.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:min-w-60 sm:items-end">
                <label className="flex w-full flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  <span id="sold-comps-grade-label">Sold grade</span>
                  <SearchSelect
                    name="soldCompsGrade"
                    labelledBy="sold-comps-grade-label"
                    value={requestedSalesFilter}
                    options={saleFilterOptions.map((condition) => ({
                      value: condition,
                      label: condition,
                    }))}
                    onChange={setSalesFilter}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setIsSalesModalOpen(false)}
                  className="btn btn-ghost btn-sm"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="sold-comps-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:max-h-[72vh] sm:px-6 sm:py-5">
              {shouldShowAllSalesFallback ? (
                <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-sm leading-6 text-amber-100">
                  No {requestedSalesFilter} sold listings passed the trust checks yet. Showing all accepted comps instead.
                </div>
              ) : null}

              {sales.length ? (
                <div className="space-y-3">
                  {sales.map((sale) => {
                  const isSelected =
                    sale.condition === activeSalesFilter ||
                    (activeSalesFilter === ALL_SALES_FILTER && sale.condition === activeSelectedGrade);

                  return (
                    <div
                      key={`${sale.date}-${sale.title}-${sale.price}-modal`}
                      className={`rounded-2xl border p-4 sm:p-5 ${
                        isSelected ? "accent-callout" : "border-[var(--line)] bg-[var(--surface)]"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="min-w-0">
                          <p className="break-words text-base font-semibold leading-6 text-white">{sale.title}</p>
                          <p className="mt-1.5 break-words text-sm leading-6 text-slate-300">
                            {sale.condition} - {sale.source}
                            {sale.seller ? ` - ${sale.seller}` : ""}
                          </p>
                          <p className="mt-2 text-xs leading-5 text-slate-400">
                            {sale.confidence ?? "low"} confidence
                            {sale.warning ? ` / ${sale.warning}` : ""}
                          </p>
                        </div>
                        <ClientPrice
                          amountUsd={sale.price}
                          className={`text-xl font-semibold ${isSelected ? "text-[var(--text)]" : "text-emerald-300"}`}
                        />
                      </div>
                      <div className="mt-4 flex flex-col gap-2 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <span>{sale.date}</span>
                        {sale.listingUrl ? (
                          <a
                            href={sale.listingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-link font-semibold"
                          >
                            View listing
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-sm leading-6 text-amber-100">
                  No {activeSalesFilter === ALL_SALES_FILTER ? "" : `${activeSalesFilter} `}sold listings passed the trust checks yet.
                </div>
              )}
            </div>
          </div>
        </div>
    ) : null}
    </>
  );
}
