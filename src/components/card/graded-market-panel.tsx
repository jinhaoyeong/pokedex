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

  return live;
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

  return isLoadingLiveMarket ? "Checking" : "Unavailable";
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
  const [salesFilter, setSalesFilter] = useState<string>(getDefaultGrade(card));
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

  const activeSalesFilter =
    salesFilter === ALL_SALES_FILTER || saleFilterOptions.includes(salesFilter)
      ? salesFilter
      : activeSelectedGrade;

  const allSales = useMemo(
    () => [...(displayCard.recentSales ?? [])].sort(compareSales),
    [displayCard.recentSales],
  );

  const sales = useMemo(
    () =>
      activeSalesFilter === ALL_SALES_FILTER
        ? allSales
        : allSales.filter((sale) => sale.condition === activeSalesFilter),
    [activeSalesFilter, allSales],
  );
  const salesPreview = sales.slice(0, 5);

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="grid gap-4 sm:gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <PriceChart
          points={displayCard.priceHistory}
          selectedGrade={activeSelectedGrade}
          snapshotAmountUsd={selectedPrice?.value}
          gradedPrices={displayCard.gradedPrices}
          visibleGradeLabels={visibleGrades.map((price) => price.grade)}
          onSelectGrade={setSelectedGrade}
        />

        <article id="graded-prices" className="glass-card rounded-3xl p-3 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div>
              <h2 className="text-base font-semibold text-white sm:text-xl">Graded prices</h2>
              <p className="mt-2 hidden text-sm text-slate-400 sm:block">
                {isLoadingLiveMarket
                  ? "Loading live sold comps in the background..."
                  : "Select a grade to update the chart and prioritize matching sold comps."}
              </p>
            </div>
            {selectedPrice ? (
              <div className="sm:text-right">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Selected</p>
                <ClientPrice
                  amountUsd={selectedPrice.value}
                className="mt-1 block text-lg font-semibold text-blue-300 sm:mt-2 sm:text-2xl"
                />
              </div>
            ) : null}
          </div>

          <div className="mt-3 space-y-3 sm:mt-5">
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
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
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] transition sm:px-3 sm:text-xs sm:tracking-[0.18em] ${
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
              <div className="sm:hidden">
                <label
                  htmlFor="mobile-graded-price"
                  className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400"
                >
                  Choose grade
                </label>
                <select
                  id="mobile-graded-price"
                  value={activeSelectedGrade}
                  onChange={(event) => setSelectedGrade(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-yellow-200/35 bg-slate-950 px-3 py-2.5 text-xs font-black text-white outline-none focus:border-yellow-300"
                >
                  {visibleGrades.map((price) => (
                    <option key={price.grade} value={price.grade} className="bg-slate-950 text-white">
                      {price.grade} / {price.confidence ?? "low"} confidence / ${price.value.toLocaleString()}
                    </option>
                  ))}
                </select>

                {selectedPrice ? (
                  <div className="mt-3 rounded-2xl border border-blue-300/40 bg-blue-500/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-white">{selectedPrice.grade}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {selectedPrice.grade === "Ungraded"
                            ? "Ungraded market comps"
                            : selectedPrice.populationCount > 0
                              ? `Pop ${selectedPrice.populationCount.toLocaleString()}`
                              : "Public sold comps"}
                          {typeof selectedPrice.saleCount === "number" && selectedPrice.saleCount > 0
                            ? ` - ${selectedPrice.saleCount} sales`
                            : ""}
                        </p>
                      </div>
                      <ClientPrice amountUsd={selectedPrice.value} className="font-black text-blue-200" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${confidenceClass(selectedPrice.confidence)}`}
                      >
                        {selectedPrice.confidence ?? "low"} confidence
                      </span>
                      {selectedPrice.warning ? (
                        <span className="rounded-full border border-amber-300/25 bg-amber-400/5 px-2 py-0.5 text-[10px] text-amber-100">
                          {selectedPrice.warning}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {visibleGrades.map((price) => {
              const isSelected = price.grade === activeSelectedGrade;

              return (
                <button
                  key={price.grade}
                  type="button"
                  onClick={() => setSelectedGrade(price.grade)}
                  className={`hidden w-full flex-col gap-3 rounded-2xl border px-4 py-3 text-left transition sm:flex sm:flex-row sm:items-center sm:justify-between ${
                    isSelected
                      ? "border-blue-400/70 bg-blue-500/10"
                      : "border-white/10 bg-white/4 hover:border-blue-300/40"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-white">{price.grade}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {price.grade === "Ungraded"
                        ? "Ungraded market comps"
                        : price.populationCount > 0
                          ? `Pop ${price.populationCount.toLocaleString()}`
                          : "Public sold comps"}
                      {typeof price.saleCount === "number" && price.saleCount > 0
                        ? ` · ${price.saleCount} sales`
                        : ""}
                    </p>
                    {price.source ? (
                      <p className="mt-1 text-[11px] text-slate-500">{price.source}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${confidenceClass(price.confidence)}`}
                      >
                        {price.confidence ?? "low"} confidence
                      </span>
                      {price.warning ? (
                        <span className="rounded-full border border-amber-300/25 bg-amber-400/5 px-2 py-0.5 text-[10px] text-amber-100">
                          {price.warning}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ClientPrice
                    amountUsd={price.value}
                    className={`text-lg font-semibold ${isSelected ? "text-blue-300" : "text-white"}`}
                  />
                </button>
              );
            })}

            {!visibleGrades.length ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
                No {selectedFamily} grades are available for this card yet.
              </div>
            ) : null}
          </div>

          {displayCard.evidenceSummary ? (
            <div className="mt-4 hidden grid-cols-2 gap-2 text-xs text-slate-300 sm:mt-5 sm:grid sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/4 p-3">
                <p className="text-slate-500">Accepted</p>
                <p className="mt-1 font-semibold text-white">{displayCard.evidenceSummary.accepted}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/4 p-3">
                <p className="text-slate-500">Rejected</p>
                <p className="mt-1 font-semibold text-white">{displayCard.evidenceSummary.rejected}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/4 p-3">
                <p className="text-slate-500">Thin</p>
                <p className="mt-1 font-semibold text-white">{displayCard.evidenceSummary.thin}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/4 p-3">
                <p className="text-slate-500">Fallback</p>
                <p className="mt-1 font-semibold text-white">{displayCard.evidenceSummary.fallback}</p>
              </div>
            </div>
          ) : null}

          {displayCard.priceConsensus?.sources.length ? (
            <div className="mt-5 hidden rounded-3xl border border-white/10 bg-white/4 p-4 sm:block">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    Consensus estimate
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    <ClientPrice amountUsd={displayCard.priceConsensus.finalEstimateUsd} />
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {displayCard.priceConsensus.methodology}
                  </p>
                </div>
                <div className="sm:text-right">
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] ${confidenceClass(displayCard.priceConsensus.confidence)}`}
                  >
                    {displayCard.priceConsensus.confidence} confidence
                  </span>
                  <p className="mt-2 text-xs text-slate-500">
                    {displayCard.priceConsensus.sourceCount} trusted sources
                    {displayCard.priceConsensus.sampleCount > 0
                      ? ` / ${displayCard.priceConsensus.sampleCount} accepted sold comps`
                      : ""}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {displayCard.priceConsensus.sources.map((source) => (
                  <div
                    key={`${source.source}-${source.evidenceType}-${source.value}`}
                    className="rounded-2xl border border-white/10 bg-slate-950/35 p-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-white">{source.source}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {source.evidenceType.replace(/_/g, " ")}
                          {typeof source.sampleCount === "number"
                            ? ` / ${source.sampleCount} samples`
                            : ""}
                        </p>
                        <p className="mt-2 text-sm text-slate-300">{source.note}</p>
                      </div>
                      <div className="sm:text-right">
                        <ClientPrice
                          amountUsd={source.value}
                          className="text-lg font-semibold text-blue-300"
                        />
                        <p className="mt-1 text-xs text-slate-500">
                          {Math.round(source.confidenceScore * 100)}% confidence
                        </p>
                      </div>
                    </div>
                    {source.sourceUrl ? (
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex text-xs text-blue-300 hover:text-blue-200"
                      >
                        View source
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <section className="grid gap-4 sm:gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="glass-card rounded-3xl p-3 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white sm:text-xl">Population report</h2>
              <p className="mt-2 hidden text-sm text-slate-400 sm:block">
                Counts appear only when a source exposes usable grade data.
              </p>
              {sourceStatuses.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sourceStatuses.slice(0, 3).map((status) => (
                    <span
                      key={`${status.source}-${status.state}`}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${sourceStateClass(status.state)}`}
                    >
                      {sourceStateLabel(status.state)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Total certified</p>
              <p className="mt-1 text-lg font-semibold text-white sm:mt-2 sm:text-2xl">
                {getPopulationTotalLabel(displayCard.psaPopulation, isLoadingLiveMarket)}
              </p>
              <span
                className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${confidenceClass(displayCard.psaPopulation.confidence)}`}
              >
                {displayCard.psaPopulation.confidence ?? "low"} trust
              </span>
            </div>
          </div>

          {displayCard.psaPopulation.grades.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:block sm:space-y-3">
              {displayCard.psaPopulation.grades.map((grade) => (
                <div
                  key={grade.grade}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/4 px-3 py-2.5 sm:px-4 sm:py-3"
                >
                  <p className="font-medium text-white">{grade.grade}</p>
                  <p className="text-sm font-semibold text-blue-300 sm:text-lg">{grade.count.toLocaleString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
              {isLoadingLiveMarket
                ? "Checking population sources..."
                : "No trusted population counts found. Prices can still use catalog snapshots and accepted sold comps."}
            </div>
          )}

          <div className="hidden">
            <p className="font-medium text-white">Source note</p>
            <p className="mt-2 break-words">
              {displayCard.psaPopulation.source} · {displayCard.psaPopulation.note}
            </p>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-3 text-xs text-slate-300 sm:p-4">
            <p className="font-medium text-white">Checked sources</p>
            <div className="mt-3 grid gap-2">
              {(sourceStatuses.length
                ? sourceStatuses
                : [
                    {
                      source: displayCard.psaPopulation.source,
                      state: displayCard.psaPopulation.status === "verified" ? "ready" : "no_match",
                      confidence: displayCard.psaPopulation.confidence ?? "low",
                      confidenceScore: displayCard.psaPopulation.confidenceScore ?? 0.3,
                      note: displayCard.psaPopulation.note,
                    } as MarketSourceStatus,
                  ]
              )
                .slice(0, 5)
                .map((status) => (
                  <div
                    key={`${status.source}-${status.state}-${status.note}`}
                    className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-white">{status.source}</span>
                      <span className="mt-0.5 block line-clamp-2 text-slate-400">{status.note}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${sourceStateClass(status.state)}`}
                    >
                      {sourceStateLabel(status.state)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </article>

        <article className="glass-card rounded-3xl p-3 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white sm:text-xl">Last sold listings</h2>
              <p className="mt-2 hidden text-sm text-slate-400 sm:block">
                Filter the sold history by raw or a specific grading label.
              </p>
            </div>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 sm:min-w-56">
              Sold filter
              <select
                value={activeSalesFilter}
                onChange={(event) => setSalesFilter(event.target.value)}
                className="rounded-2xl border border-blue-400/30 bg-slate-950 px-3 py-2 text-xs font-black normal-case tracking-normal text-white outline-none focus:border-blue-300"
              >
                {saleFilterOptions.map((condition) => (
                  <option key={condition} value={condition} className="bg-slate-950 text-white">
                    {condition}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {sales.length ? (
              <div className="mt-3 space-y-2 sm:mt-5 sm:space-y-3">
              {salesPreview.map((sale) => {
                const isSelected =
                  sale.condition === activeSalesFilter ||
                  (activeSalesFilter === ALL_SALES_FILTER && sale.condition === activeSelectedGrade);

                return (
                  <div
                    key={`${sale.date}-${sale.title}-${sale.price}`}
                    className={`rounded-2xl border p-3 sm:p-4 ${
                      isSelected ? "border-blue-400/50 bg-blue-500/10" : "border-white/10 bg-white/4"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="font-medium text-white">{sale.title}</p>
                        <p className="mt-1 break-words text-sm text-slate-400">
                          {sale.condition} · {sale.source}
                          {sale.seller ? ` · ${sale.seller}` : ""}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {sale.confidence ?? "low"} confidence
                          {sale.warning ? ` / ${sale.warning}` : ""}
                        </p>
                      </div>
                      <ClientPrice
                        amountUsd={sale.price}
                        className={`text-lg font-semibold ${isSelected ? "text-blue-300" : "text-emerald-300"}`}
                      />
                    </div>
                    <div className="mt-3 flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <span>{sale.date}</span>
                      {sale.listingUrl ? (
                        <a
                          href={sale.listingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-300 hover:text-blue-200"
                        >
                          View listing
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {sales.length ? (
                <button
                  type="button"
                  onClick={() => setIsSalesModalOpen(true)}
                  className="w-full rounded-2xl border border-blue-400/40 bg-blue-500/10 px-4 py-3 text-sm font-medium text-blue-200 transition hover:border-blue-300 hover:bg-blue-500/15"
                >
                  Open sold history ({sales.length}
                  {sales.length !== allSales.length ? ` of ${allSales.length}` : ""})
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
              No {activeSalesFilter === ALL_SALES_FILTER ? "" : `${activeSalesFilter} `}sold listings passed the trust checks yet.
            </div>
          )}
        </article>
      </section>

      {isSalesModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-8">
          <div className="glass-card max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10">
            <div className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
              <div>
                <h3 className="text-xl font-semibold text-white">Last sold listings</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Showing {activeSalesFilter === ALL_SALES_FILTER ? "all accepted comps" : activeSalesFilter}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSalesModalOpen(false)}
                className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 hover:border-blue-300/40 hover:text-white sm:shrink-0"
              >
                Close
              </button>
            </div>
            <div className="max-h-[72vh] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              <div className="space-y-3">
                {sales.map((sale) => {
                  const isSelected =
                    sale.condition === activeSalesFilter ||
                    (activeSalesFilter === ALL_SALES_FILTER && sale.condition === activeSelectedGrade);

                  return (
                    <div
                      key={`${sale.date}-${sale.title}-${sale.price}-modal`}
                      className={`rounded-2xl border p-4 ${
                        isSelected ? "border-blue-400/50 bg-blue-500/10" : "border-white/10 bg-white/4"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-white">{sale.title}</p>
                          <p className="mt-1 break-words text-sm text-slate-400">
                            {sale.condition} · {sale.source}
                            {sale.seller ? ` · ${sale.seller}` : ""}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            {sale.confidence ?? "low"} confidence
                            {sale.warning ? ` / ${sale.warning}` : ""}
                          </p>
                        </div>
                        <ClientPrice
                          amountUsd={sale.price}
                          className={`text-lg font-semibold ${isSelected ? "text-blue-300" : "text-emerald-300"}`}
                        />
                      </div>
                      <div className="mt-3 flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <span>{sale.date}</span>
                        {sale.listingUrl ? (
                          <a
                            href={sale.listingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-300 hover:text-blue-200"
                          >
                            View listing
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
