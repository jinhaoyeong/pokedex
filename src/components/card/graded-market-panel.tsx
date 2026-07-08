"use client";

import { useEffect, useMemo, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { SearchSelect } from "@/components/search/search-select";
import { useManagedCardGradingMarket } from "@/components/card/card-grading-market-context";
import { PriceChart } from "@/components/card/price-chart";
import { buildGradingMarketParams } from "@/lib/grading-market-params";
import { cardNeedsGradingMarketEnrichment } from "@/lib/grading-market-lookup";
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
const SOLD_HISTORY_DISPLAY_LIMIT = 10;
const PREVIEW_SALE_SOURCE_PATTERN =
  /static grail preview|bundled grail preview|premium preview composite|preview model|partial cached/i;
const UNKNOWN_SOLD_DATE_LABEL = "Date Unknown";
const UNKNOWN_SOLD_PRICE_LABEL = "Price N/A";

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

function hasPriceValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function GradePriceValue({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  if (!hasPriceValue(value)) {
    return <span className={`price-value-empty ${className ?? ""}`}>N/A</span>;
  }

  return <ClientPrice amountUsd={value} className={className} />;
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

type SafeSaleRecord = SaleRecord & {
  listingUrl?: string;
  displayDate: string;
  displayPrice: number | null;
};

function coerceSaleString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getSaleListingUrl(sale: SaleRecord) {
  const possibleUrl = (sale as SaleRecord & { url?: unknown }).url;
  const targetUrl =
    coerceSaleString(sale.listingUrl) ||
    coerceSaleString(sale.sourceUrl) ||
    coerceSaleString(possibleUrl);

  if (!targetUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function getSaleDisplayDate(sale: SaleRecord) {
  const rawDate = coerceSaleString(sale.date);

  if (!rawDate) {
    return UNKNOWN_SOLD_DATE_LABEL;
  }

  const parsed = Date.parse(rawDate);

  if (Number.isNaN(parsed)) {
    return rawDate || UNKNOWN_SOLD_DATE_LABEL;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function getSaleDisplayPrice(sale: SaleRecord) {
  return typeof sale.price === "number" && Number.isFinite(sale.price) && sale.price > 0
    ? sale.price
    : null;
}

function normalizeSaleRecord(sale: SaleRecord): SafeSaleRecord {
  const displayDate = getSaleDisplayDate(sale);
  const displayPrice = getSaleDisplayPrice(sale);

  return {
    ...sale,
    title: coerceSaleString(sale.title) || "Untitled sold listing",
    condition: coerceSaleString(sale.condition) || "Ungraded",
    source: coerceSaleString(sale.source) || "Unknown source",
    seller: coerceSaleString(sale.seller) || undefined,
    confidence: sale.confidence,
    warning: coerceSaleString(sale.warning) || undefined,
    listingUrl: getSaleListingUrl(sale),
    displayDate,
    displayPrice,
  };
}

function isPreviewSale(sale: SaleRecord) {
  return PREVIEW_SALE_SOURCE_PATTERN.test(
    [sale.source, sale.listingUrl, sale.sourceUrl, (sale as SaleRecord & { url?: unknown }).url]
      .filter(Boolean)
      .join(" "),
  );
}

function GradeValuesEmptyState({
  selectedFamily,
  hasRawValue,
  sourceStatuses,
}: {
  selectedFamily: string;
  hasRawValue: boolean;
  sourceStatuses: MarketSourceStatus[];
}) {
  const inactiveSources = sourceStatuses
    .filter(
      (status) =>
        status.source !== "PokemonTCG/Cardmarket catalog" &&
        (status.state === "no_match" ||
          status.state === "failed" ||
          status.state === "missing_credentials" ||
          status.state === "disabled"),
    )
    .slice(0, 3);
  const title =
    selectedFamily !== "All" && selectedFamily !== "Ungraded"
      ? `No ${selectedFamily} slab values yet`
      : hasRawValue
        ? "No graded slab values yet"
        : "No graded market data yet";

  return (
    <div className="grade-values-empty-state rounded-xl border px-3.5 py-3 text-sm leading-6 sm:px-4 sm:py-3.5">
      <p className="font-semibold text-white">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-slate-300 sm:text-sm sm:leading-6">
        {hasRawValue
          ? "Raw market value loaded, but the public grading sources did not expose usable PSA, BGS, CGC, TAG, or SGC rows for this card."
          : "No recent graded market data is available for this card from the connected public sources."}
      </p>
      {inactiveSources.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {inactiveSources.map((status) => (
            <span
              key={`${status.source}-${status.state}`}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${sourceStateClass(status.state)}`}
              title={status.note}
            >
              {status.source.replace(/\s+public\s+/i, " ")}: {sourceStateLabel(status.state)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GradedMarketLoadingSkeleton() {
  const gradeRows = Array.from({ length: 4 }, (_, index) => index);
  const popRows = Array.from({ length: 6 }, (_, index) => index);

  return (
    <div className="grid items-start gap-2 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)]">
      <article className="graded-price-panel glass-card order-1 flex flex-col self-start rounded-2xl p-4 sm:p-5 xl:sticky xl:top-4 xl:col-start-2 xl:row-start-1 xl:row-span-2">
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
          <div className="h-6 w-32 animate-pulse rounded bg-white/12" />
        </div>
        <div className="mt-4 h-10 animate-pulse rounded-full bg-white/10" />
        <div className="mt-4 rounded-xl border border-white/10 bg-white/4 p-3">
          <div className="h-14 animate-pulse rounded-lg bg-white/10" />
          <div className="mt-3 space-y-2">
            {gradeRows.map((row) => (
              <div key={row} className="grid grid-cols-[1fr_5rem_4rem] gap-3">
                <div className="h-9 animate-pulse rounded bg-white/8" />
                <div className="h-9 animate-pulse rounded bg-white/8" />
                <div className="h-9 animate-pulse rounded bg-white/8" />
              </div>
            ))}
          </div>
        </div>
      </article>

      <article className="price-history-panel glass-card order-2 rounded-2xl p-4 sm:p-5 xl:col-start-1 xl:row-start-1">
        <div className="h-72 animate-pulse rounded-xl bg-white/8" />
      </article>

      <article className="population-panel glass-card order-3 rounded-2xl p-4 sm:p-5 xl:col-start-1 xl:row-start-2">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-5 w-28 animate-pulse rounded bg-white/12" />
            <div className="h-3 w-52 animate-pulse rounded bg-white/8" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-14 animate-pulse rounded bg-white/8" />
            <div className="h-7 w-20 animate-pulse rounded bg-white/12" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {popRows.map((row) => (
            <div key={row} className="pop-cell h-14 animate-pulse" />
          ))}
        </div>
      </article>
    </div>
  );
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
    requestFullMarket?: () => void;
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
  const resolvedLoadingFullMarket =
    managedMarket?.isLoadingFullMarket ?? sharedMarket?.isLoadingFull ?? false;
  const requestFullMarket = managedMarket?.requestFullMarket ?? sharedMarket?.requestFullMarket;

  useEffect(() => {
    if (sharedMarket || managedMarket) {
      return;
    }

    if (
      liveMarketPrefetched &&
      hasPopulationSignal(card.psaPopulation) &&
      !cardNeedsGradingMarketEnrichment(card)
    ) {
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
          !/catalog baseline looked like/i.test(incomingConsensus.methodology) &&
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
          marketPriceUsd: current.marketPriceUsd,
          gradedPrices: data.gradedPrices?.length ? data.gradedPrices : current.gradedPrices,
          priceHistory: mergePriceHistory(current.priceHistory, data.priceHistory ?? []),
          recentSales: Array.isArray(data.recentSales) && data.recentSales.length
            ? data.recentSales
            : current.recentSales,
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
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => response.json().catch(() => null) as Promise<GradingMarketResponse | null>)
        .then(applyData)
        .catch(() => undefined);

    fetchPhase("core").finally(() => {
      if (!controller.signal.aborted) {
        setIsLoadingLiveMarket(false);
      }
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
  const hasRawGradeValue = displayCard.gradedPrices.some(
    (price) => price.grade === "Ungraded" && hasPriceValue(price.value),
  );
  const hasSlabGradeValues = displayCard.gradedPrices.some(
    (price) => price.grade !== "Ungraded" && hasPriceValue(price.value),
  );
  const selectedFamilyHasValues = visibleGrades.some((price) => hasPriceValue(price.value));
  const shouldShowGradeValuesEmptyState = !hasSlabGradeValues || !selectedFamilyHasValues;
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
  const soldComps = Array.isArray(displayCard.recentSales) ? displayCard.recentSales : [];

  const saleFilterOptions = useMemo(() => {
    const conditions = [
      ALL_SALES_FILTER,
      activeSelectedGrade,
      "Ungraded",
      ...displayCard.gradedPrices.map((price) => price.grade),
      ...soldComps.map((sale) => coerceSaleString(sale.condition)),
    ];

    return conditions.filter(
      (condition, index) => condition && conditions.indexOf(condition) === index,
    );
  }, [activeSelectedGrade, displayCard.gradedPrices, soldComps]);

  const requestedSalesFilter =
    salesFilter === ALL_SALES_FILTER || saleFilterOptions.includes(salesFilter)
      ? salesFilter
      : activeSelectedGrade;

  const allSales = useMemo(
    () =>
      soldComps
        .filter((sale) => !isPreviewSale(sale))
        .map(normalizeSaleRecord)
        .sort(compareSales),
    [soldComps],
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
  const visibleSales = sales.slice(0, SOLD_HISTORY_DISPLAY_LIMIT);
  const visibleSourceStatuses = sourceStatuses.filter(
    (status) =>
      status.state === "ready" || status.state === "cached" || status.state === "fallback",
  );
  const populationIsEstimated = populationSourceSummary.isEnglishParallelEstimate;
  const populationBadgeClass = populationIsEstimated
    ? "status-badge--estimated"
    : confidenceClass(populationReportConfidence);
  const openSalesModal = () => {
    requestFullMarket?.();
    setIsSalesModalOpen(true);
  };

  if (resolvedLoadingLiveMarket) {
    return <GradedMarketLoadingSkeleton />;
  }

  console.log("Hydrated Sold Comps:", soldComps);

  return (
    <>
    <div className="grid items-start gap-2 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)]">
        <article id="graded-prices" className="graded-price-panel glass-card order-1 flex flex-col self-start rounded-2xl p-4 sm:p-5 xl:sticky xl:top-4 xl:col-start-2 xl:row-start-1 xl:row-span-2">
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
                      <GradePriceValue
                        value={selectedPrice.value}
                        className="figure-mono accent-callout-value min-w-0 break-words text-right text-lg font-semibold sm:text-xl"
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

                <div className="grade-price-table overflow-hidden rounded-xl border border-white/10 bg-white/4">
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
                          <GradePriceValue
                            value={price.value}
                            className={`figure-mono min-w-0 break-words text-right text-[13px] font-semibold sm:text-base ${isSelected ? "text-[var(--text)]" : "text-white"}`}
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
                                <GradePriceValue
                                  value={price.value}
                                  className="figure-mono text-right font-semibold"
                                />
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

            {shouldShowGradeValuesEmptyState ? (
              <GradeValuesEmptyState
                selectedFamily={selectedFamily}
                hasRawValue={hasRawGradeValue}
                sourceStatuses={sourceStatuses}
              />
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
                onClick={openSalesModal}
                disabled={resolvedLoadingFullMarket}
                className="btn btn-ghost btn-sm"
              >
                {resolvedLoadingFullMarket ? "Loading" : "Open"}
              </button>
            </div>
          </div>
        </article>

        <article
          className="price-history-panel glass-card order-2 rounded-2xl p-4 sm:p-5 xl:col-start-1 xl:row-start-1"
          onFocusCapture={() => requestFullMarket?.()}
          onPointerDownCapture={() => requestFullMarket?.()}
        >
        <PriceChart
          embedded
          points={displayCard.priceHistory}
          recentSales={displayCard.recentSales}
          selectedGrade={activeSelectedGrade}
          snapshotAmountUsd={selectedPrice?.value}
          gradedPrices={displayCard.gradedPrices}
          visibleGradeLabels={visibleGrades.map((price) => price.grade)}
          onSelectGrade={setSelectedGrade}
        />
        </article>

        <article className="population-panel glass-card order-3 rounded-2xl p-4 sm:p-5 xl:col-start-1 xl:row-start-2">
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
              {visibleSourceStatuses.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-2.5 sm:gap-2">
                  {visibleSourceStatuses.slice(0, 6).map((status) => (
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
              <p className="figure-mono mt-1 whitespace-nowrap text-xl font-semibold leading-none text-white sm:text-2xl">
                {typeof filteredPopulationTotal === "number"
                  ? filteredPopulationTotal.toLocaleString()
                  : getPopulationTotalLabel(displayCard, resolvedLoadingLiveMarket)}
              </p>
              <span
                className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] sm:mt-2 sm:px-2.5 sm:py-1 sm:text-[11px] sm:tracking-[0.1em] ${populationBadgeClass}`}
              >
                {populationIsEstimated ? "Estimated" : `${populationReportConfidence} trust`}
              </span>
            </div>
          </div>

          {populationSourceSummary.isEnglishParallelEstimate ? (
            <div className="mt-3 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2.5 text-xs leading-5 text-[var(--text-dim)] sm:text-sm">
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
                  className="pop-cell flex min-h-10 items-center justify-between gap-2 px-2.5 py-2 sm:min-h-12 sm:gap-3 sm:px-3.5 sm:py-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white sm:text-sm">{grade.grade}</p>
                    {grade.confidence ? (
                      <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                        {populationIsEstimated ? "Estimated" : `${grade.confidence} confidence`}
                      </p>
                    ) : null}
                  </div>
                  <p className="figure-mono text-sm font-semibold text-[var(--text)] sm:text-base">
                    {typeof grade.count === "number" ? grade.count.toLocaleString() : "No data"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="population-empty-state mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-sm leading-5 text-amber-100 sm:mt-4 sm:px-3.5 sm:py-3 sm:leading-6">
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
                  Showing {visibleSales.length ? `${visibleSales.length} recent accepted comp${visibleSales.length === 1 ? "" : "s"}` : "recent accepted comps"}
                  {activeSalesFilter === ALL_SALES_FILTER ? "." : ` for ${activeSalesFilter}.`}
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

              {visibleSales.length ? (
                <div className="space-y-3">
                  {visibleSales.map((sale) => {
                  const isSelected =
                    sale.condition === activeSalesFilter ||
                    (activeSalesFilter === ALL_SALES_FILTER && sale.condition === activeSelectedGrade);

                  return (
                    <div
                      key={`${sale.displayDate}-${sale.title}-${sale.displayPrice ?? UNKNOWN_SOLD_PRICE_LABEL}-${sale.condition}-modal`}
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
                        {sale.displayPrice == null ? (
                          <span className={`figure-mono text-xl font-semibold ${isSelected ? "text-[var(--text)]" : "text-emerald-300"}`}>
                            {UNKNOWN_SOLD_PRICE_LABEL}
                          </span>
                        ) : (
                          <ClientPrice
                            amountUsd={sale.displayPrice}
                            className={`figure-mono text-xl font-semibold ${isSelected ? "text-[var(--text)]" : "text-emerald-300"}`}
                          />
                        )}
                      </div>
                      <div className="mt-4 flex flex-col gap-2 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <span>{sale.displayDate}</span>
                        {sale.listingUrl ? (
                          <a
                            href={sale.listingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm self-start whitespace-nowrap"
                          >
                            View Listing
                          </a>
                        ) : (
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                            Listing link unavailable
                          </span>
                        )}
                      </div>
                    </div>
                  );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-sm leading-6 text-amber-100">
                  No recent sales records found.
                </div>
              )}
            </div>
          </div>
        </div>
    ) : null}
    </>
  );
}
