"use client";

import { useEffect, useMemo, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { PriceChart } from "@/components/card/price-chart";
import type {
  EvidenceSummary,
  GradedPrice,
  PricePoint,
  PsaPopulationSnapshot,
  SaleRecord,
  TcgCard,
} from "@/types/pokemon";

const GRADER_FAMILIES = ["All", "Ungraded", "PSA", "BGS", "CGC", "TAG", "SGC"] as const;

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

function compareSales(left: SaleRecord, right: SaleRecord, selectedGrade: string) {
  const leftSelected = left.condition === selectedGrade ? 1 : 0;
  const rightSelected = right.condition === selectedGrade ? 1 : 0;

  if (leftSelected !== rightSelected) {
    return rightSelected - leftSelected;
  }

  return right.date.localeCompare(left.date);
}

function mergePriceHistory(catalog: PricePoint[], live: PricePoint[]) {
  if (!live.length) {
    return catalog;
  }

  const merged = new Map<string, PricePoint>();

  for (const point of catalog) {
    merged.set(point.date, {
      ...point,
      gradeValues: { Ungraded: point.value, ...point.gradeValues },
    });
  }

  for (const point of live) {
    const existing = merged.get(point.date);
    merged.set(
      point.date,
      existing
        ? {
            ...existing,
            value: point.value || existing.value,
            gradeValues: { ...existing.gradeValues, ...point.gradeValues },
          }
        : point,
    );
  }

  return [...merged.values()];
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

function confidenceClass(confidence?: string) {
  if (confidence === "high") return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
  if (confidence === "medium") return "border-blue-300/35 bg-blue-500/10 text-blue-100";
  return "border-amber-300/35 bg-amber-400/10 text-amber-100";
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
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const displayCard = liveCard;

  useEffect(() => {
    if (liveMarketPrefetched) {
      return;
    }

    const controller = new AbortController();
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
            gradedPrices: data.gradedPrices?.length ? data.gradedPrices : current.gradedPrices,
            priceHistory: mergePriceHistory(current.priceHistory, data.priceHistory ?? []),
            recentSales: data.recentSales?.length ? data.recentSales : current.recentSales,
            evidenceSummary: data.evidenceSummary ?? current.evidenceSummary,
          }));
        },
      )
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingLiveMarket(false);
        }
      });

    return () => controller.abort();
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

  const sales = useMemo(
    () =>
      [...(displayCard.recentSales ?? [])].sort((left, right) =>
        compareSales(left, right, activeSelectedGrade),
      ),
    [activeSelectedGrade, displayCard.recentSales],
  );
  const salesPreview = sales.slice(0, 5);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <PriceChart
          points={displayCard.priceHistory}
          selectedGrade={activeSelectedGrade}
          snapshotAmountUsd={selectedPrice?.value}
          gradedPrices={displayCard.gradedPrices}
        />

        <article id="graded-prices" className="glass-card rounded-3xl p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Graded prices</h2>
              <p className="mt-2 text-sm text-slate-400">
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
                  className="mt-2 block text-2xl font-semibold text-blue-300"
                />
              </div>
            ) : null}
          </div>

          <div className="mt-5 space-y-3">
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
                  className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition ${
                    selectedFamily === family
                      ? "border-blue-400/70 bg-blue-500/10 text-blue-200"
                      : "border-white/10 text-slate-300 hover:border-blue-300/40"
                  }`}
                >
                  {family}
                </button>
              ))}
            </div>

            {visibleGrades.map((price) => {
              const isSelected = price.grade === activeSelectedGrade;

              return (
                <button
                  key={price.grade}
                  type="button"
                  onClick={() => setSelectedGrade(price.grade)}
                  className={`flex w-full flex-col gap-3 rounded-2xl border px-4 py-3 text-left transition sm:flex-row sm:items-center sm:justify-between ${
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
            <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
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
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="glass-card rounded-3xl p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Population report</h2>
              <p className="mt-2 text-sm text-slate-400">
                Public population counts normalized into our own report layout.
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Total certified</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {typeof displayCard.psaPopulation.totalCertified === "number"
                  ? displayCard.psaPopulation.totalCertified.toLocaleString()
                  : "Pending"}
              </p>
            </div>
          </div>

          {displayCard.psaPopulation.grades.length ? (
            <div className="mt-5 space-y-3">
              {displayCard.psaPopulation.grades.map((grade) => (
                <div
                  key={grade.grade}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/4 px-4 py-3"
                >
                  <p className="font-medium text-white">{grade.grade}</p>
                  <p className="text-lg font-semibold text-blue-300">{grade.count.toLocaleString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
              Population counts are still unavailable for this card.
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/4 p-4 text-sm text-slate-300">
            <p className="font-medium text-white">Source note</p>
            <p className="mt-2 break-words">
              {displayCard.psaPopulation.source} · {displayCard.psaPopulation.note}
            </p>
          </div>
        </article>

        <article className="glass-card rounded-3xl p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Last sold listings</h2>
              <p className="mt-2 text-sm text-slate-400">
                All comps stay visible, and listings for the selected grade are surfaced first.
              </p>
            </div>
            <div className="rounded-2xl border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.22em] text-blue-200">
              {activeSelectedGrade}
            </div>
          </div>

          {sales.length ? (
            <div className="mt-5 space-y-3">
              {salesPreview.map((sale) => {
                const isSelected = sale.condition === activeSelectedGrade;

                return (
                  <div
                    key={`${sale.date}-${sale.title}-${sale.price}`}
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
              {sales.length ? (
                <button
                  type="button"
                  onClick={() => setIsSalesModalOpen(true)}
                  className="w-full rounded-2xl border border-blue-400/40 bg-blue-500/10 px-4 py-3 text-sm font-medium text-blue-200 transition hover:border-blue-300 hover:bg-blue-500/15"
                >
                  Open sold history ({sales.length})
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
              No sold listings are available yet for this card.
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
                  Full sold history for the selected card, with {activeSelectedGrade} surfaced first.
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
                  const isSelected = sale.condition === activeSelectedGrade;

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
