"use client";

import { useEffect, useMemo, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { PriceChart } from "@/components/card/price-chart";
import type {
  EvidenceSummary,
  GradedPrice,
  MarketEvidence,
  MarketSourceStatus,
  PricePoint,
  PriceConsensus,
  PsaPopulationSnapshot,
  SaleRecord,
  TcgCard,
} from "@/types/pokemon";

const GRADER_FAMILIES = ["All", "Ungraded", "PSA", "BGS", "CGC", "TAG", "SGC"] as const;
const LIVE_MARKET_TIMEOUT_MS = 45_000;
const ALL_SALES_FILTER = "All";
const FEATURED_GRADE_LIMIT = 4;

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
    });
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
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
  snapshot: PsaPopulationSnapshot,
  isLoadingLiveMarket: boolean,
) {
  if (typeof snapshot.totalCertified === "number") {
    return snapshot.totalCertified.toLocaleString();
  }

  return isLoadingLiveMarket ? "Checking" : "Not found";
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
  if (confidence === "medium") return "border-blue-300/35 bg-blue-500/10 text-blue-100";
  return "border-amber-300/35 bg-amber-400/10 text-amber-100";
}

function sourceStateClass(state?: MarketSourceStatus["state"]) {
  if (state === "ready" || state === "cached") {
    return "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";
  }
  if (state === "fallback") {
    return "border-blue-300/35 bg-blue-500/10 text-blue-100";
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
}: {
  card: TcgCard;
  liveMarketPrefetched?: boolean;
}) {
  const [liveCard, setLiveCard] = useState(card);
  const [isLoadingLiveMarket, setIsLoadingLiveMarket] = useState(!liveMarketPrefetched);
  const [selectedGrade, setSelectedGrade] = useState<string>(getDefaultGrade(card));
  const [selectedFamily, setSelectedFamily] = useState<string>("All");
  const [isGradePickerOpen, setIsGradePickerOpen] = useState(false);
  const [salesFilter, setSalesFilter] = useState<string>(ALL_SALES_FILTER);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const displayCard = liveCard;

  useEffect(() => {
    if (liveMarketPrefetched) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      setIsLoadingLiveMarket(false);
    }, LIVE_MARKET_TIMEOUT_MS);
    const lookupSetName = card.setEnglishName?.trim() || card.setName;
    const lookupCardName =
      card.language !== "en" && card.englishName?.trim()
        ? card.englishName.trim()
        : card.name;
    const params = new URLSearchParams({
      setName: lookupSetName,
      cardName: lookupCardName,
      cardNumber: card.collectorNumber,
      rawMarketPriceUsd: card.marketPriceUsd.toString(),
    });
    const setTotal = card.setPrintedTotal ?? card.setTotal;
    if (typeof setTotal === "number" && setTotal > 0) {
      params.set("setTotal", setTotal.toString());
    }

    fetch(`/api/grading-market?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: {
            psaPopulation: PsaPopulationSnapshot | null;
            gradedPrices: GradedPrice[];
            priceHistory: PricePoint[];
            recentSales: SaleRecord[];
            evidenceSummary?: EvidenceSummary;
            sourceStatus?: MarketSourceStatus[];
            marketEvidence?: MarketEvidence[];
            priceConsensus?: PriceConsensus;
          } | null,
        ) => {
          if (!data || controller.signal.aborted) {
            return;
          }

          setLiveCard((current) => ({
            ...current,
            psaPopulation: shouldUseLivePopulation(data.psaPopulation, current.psaPopulation)
              ? data.psaPopulation!
              : current.psaPopulation,
            marketPriceUsd: data.priceConsensus?.finalEstimateUsd ?? current.marketPriceUsd,
            gradedPrices: data.gradedPrices?.length ? data.gradedPrices : current.gradedPrices,
            priceHistory: mergePriceHistory(current.priceHistory, data.priceHistory ?? []),
            recentSales: data.recentSales?.length ? data.recentSales : current.recentSales,
            evidenceSummary: data.evidenceSummary ?? current.evidenceSummary,
            sourceStatus: data.sourceStatus ?? data.evidenceSummary?.sourceStatus ?? current.sourceStatus,
            marketEvidence: data.marketEvidence ?? current.marketEvidence,
            priceConsensus: data.priceConsensus ?? current.priceConsensus,
          }));
        },
      )
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted) {
          setIsLoadingLiveMarket(false);
        }
      });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [card, liveMarketPrefetched]);

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
    <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,26rem)]">
      <div className="space-y-4 sm:space-y-5">
        <PriceChart
          points={displayCard.priceHistory}
          selectedGrade={activeSelectedGrade}
          snapshotAmountUsd={selectedPrice?.value}
          gradedPrices={displayCard.gradedPrices}
          visibleGradeLabels={visibleGrades.map((price) => price.grade)}
          onSelectGrade={setSelectedGrade}
        />

        <article className="glass-card rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">Population</h2>
              {sourceStatuses.length ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {sourceStatuses.slice(0, 3).map((status) => (
                    <span
                      key={`${status.source}-${status.state}`}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${sourceStateClass(status.state)}`}
                    >
                      {sourceStateLabel(status.state)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-[0.11em] text-slate-400">Total</p>
              <p className="mt-1 whitespace-nowrap text-2xl font-semibold leading-none text-white">
                {getPopulationTotalLabel(displayCard.psaPopulation, isLoadingLiveMarket)}
              </p>
              <span
                className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${confidenceClass(displayCard.psaPopulation.confidence)}`}
              >
                {displayCard.psaPopulation.confidence ?? "low"} trust
              </span>
            </div>
          </div>

          {displayCard.psaPopulation.grades.length ? (
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {displayCard.psaPopulation.grades.map((grade) => (
                <div
                  key={grade.grade}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/4 px-3.5 py-3"
                >
                  <p className="text-sm font-semibold text-white">{grade.grade}</p>
                  <p className="text-base font-semibold text-blue-300">{grade.count.toLocaleString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3.5 py-3 text-sm leading-6 text-amber-100">
              {isLoadingLiveMarket
                ? "Checking population sources..."
                : "No public population table found."}
            </div>
          )}
        </article>
      </div>

      <aside className="space-y-4 sm:space-y-5">
        <article id="graded-prices" className="glass-card rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">Grade values</h2>
              <p className="mt-1.5 text-sm leading-5 text-slate-300">Select grade for chart.</p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
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
                  className={`inline-flex min-h-8 items-center justify-center rounded-xl border px-3 py-1.5 text-center text-xs font-semibold uppercase leading-none tracking-[0.07em] transition ${
                    selectedFamily === family
                      ? "border-blue-400/70 bg-blue-500/10 text-blue-200"
                      : "border-white/10 text-slate-300 hover:border-blue-300/40"
                  }`}
                >
                  {family}
                </button>
              ))}
            </div>

            {visibleGrades.length ? (
              <div className="space-y-4">
                <select
                  value={activeSelectedGrade}
                  onChange={(event) => setSelectedGrade(event.target.value)}
                  className="h-11 w-full rounded-xl border border-yellow-200/30 bg-slate-950 px-3 text-sm font-semibold text-white outline-none transition focus:border-yellow-300"
                >
                  {visibleGrades.map((price) => (
                    <option key={price.grade} value={price.grade} className="bg-slate-950 text-white">
                      {priceOptionLabel(price)}
                    </option>
                  ))}
                </select>

                {selectedPrice ? (
                  <div className="rounded-xl border border-blue-400/45 bg-blue-500/10 px-4 py-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.1em] text-blue-200">
                          Selected
                        </p>
                        <p className="mt-1 break-words text-lg font-semibold leading-snug text-white">
                          {selectedPrice.grade}
                        </p>
                      </div>
                      <ClientPrice
                        amountUsd={selectedPrice.value}
                        className="shrink-0 text-xl font-semibold text-blue-200"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm leading-5 text-slate-300">
                      <span>{getEvidenceLabel(selectedPrice)}</span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${confidenceClass(selectedPrice.confidence)}`}
                      >
                        {selectedPrice.confidence ?? "low"}
                      </span>
                      {selectedPrice.warning ? (
                        <span className="rounded-full border border-amber-300/25 bg-amber-400/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-amber-100">
                          Thin evidence
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="overflow-hidden rounded-xl border border-white/10 bg-white/4">
                  <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(6.4rem,auto)_minmax(4.8rem,auto)] gap-2 border-b border-white/10 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.09em] text-slate-400">
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
                          className={`grid min-h-[4.25rem] w-full grid-cols-[minmax(0,1.1fr)_minmax(6.4rem,auto)_minmax(4.8rem,auto)] items-center gap-2 px-4 py-3 text-left transition ${
                            isSelected
                              ? "bg-blue-500/15"
                              : "bg-slate-950/20 hover:bg-white/5"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold leading-snug text-white">{price.grade}</p>
                            <p className="mt-1 break-words text-xs leading-snug text-slate-400">{getEvidenceLabel(price)}</p>
                          </div>
                          <ClientPrice
                            amountUsd={price.value}
                            className={`text-right text-base font-semibold ${isSelected ? "text-blue-300" : "text-white"}`}
                          />
                          <span
                            className={`justify-self-end rounded-full border px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${confidenceClass(price.confidence)}`}
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
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-white/10 px-3 py-2 text-center text-sm font-semibold text-slate-300 transition hover:border-blue-300/40 hover:text-white"
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
                                    ? "bg-blue-500/15 text-blue-100"
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
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-300 sm:grid-cols-4">
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

          {displayCard.priceConsensus?.sources.length ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/4 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-400">
                    Consensus
                  </p>
                  <p className="mt-1 text-xl font-semibold text-white">
                    <ClientPrice amountUsd={displayCard.priceConsensus.finalEstimateUsd} />
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${confidenceClass(displayCard.priceConsensus.confidence)}`}
                >
                  {displayCard.priceConsensus.confidence}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {displayCard.priceConsensus.sourceCount} trusted sources
                {displayCard.priceConsensus.sampleCount > 0
                  ? ` / ${displayCard.priceConsensus.sampleCount} accepted comps`
                  : ""}
              </p>
            </div>
          ) : null}
        </article>

        <article className="glass-card rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">Sold comps</h2>
              <p className="mt-1.5 text-sm leading-5 text-slate-300">
                {allSales.length
                  ? `${allSales.length} accepted comp${allSales.length === 1 ? "" : "s"} available.`
                  : "No accepted sold comps are available yet."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsSalesModalOpen(true)}
              disabled={!allSales.length}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-blue-400/40 bg-blue-500/10 px-4 py-2 text-center text-sm font-semibold leading-none text-blue-200 transition hover:border-blue-300 hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              Open
            </button>
          </div>
        </article>
      </aside>

      {isSalesModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/78 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-8">
          <div className="glass-card max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10">
            <div className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
              <div className="min-w-0">
                <h3 className="font-[var(--font-game-copy)] text-2xl font-semibold leading-tight text-white">Last sold listings</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Showing {activeSalesFilter === ALL_SALES_FILTER ? "all accepted comps" : activeSalesFilter}.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:min-w-60 sm:items-end">
                <label className="flex w-full flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  Sold grade
                  <select
                    value={requestedSalesFilter}
                    onChange={(event) => setSalesFilter(event.target.value)}
                    className="h-11 rounded-xl border border-blue-400/30 bg-slate-950 px-3 text-sm font-black normal-case tracking-normal text-white outline-none transition focus:border-blue-300"
                  >
                    {saleFilterOptions.map((condition) => (
                      <option key={condition} value={condition} className="bg-slate-950 text-white">
                        {condition}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setIsSalesModalOpen(false)}
                  className="inline-flex min-h-9 items-center justify-center rounded-xl border border-white/10 px-4 py-1.5 text-center text-sm font-semibold leading-none text-slate-300 hover:border-blue-300/40 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[72vh] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
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
                        isSelected ? "border-blue-400/50 bg-blue-500/10" : "border-white/10 bg-white/4"
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
                          className={`text-xl font-semibold ${isSelected ? "text-blue-300" : "text-emerald-300"}`}
                        />
                      </div>
                      <div className="mt-4 flex flex-col gap-2 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <span>{sale.date}</span>
                        {sale.listingUrl ? (
                          <a
                            href={sale.listingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-blue-300 hover:text-blue-200"
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
    </div>
  );
}
