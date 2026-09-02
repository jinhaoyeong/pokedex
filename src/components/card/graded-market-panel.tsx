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
import { shouldShowNmSecondary } from "@/lib/price/priced-payload";
import { mergeLiveMarketHistory, mergeLiveRecentSales, shouldApplyLiveMarketPayload } from "@/lib/market/live-market-merge";
import { summarizeMarketSourceFailures } from "@/lib/market/source-failure";
import { CARD_DETAIL_FIRST_PAINT_CLIENT_MS } from "@/lib/market/grading-budgets";
import { filterSalesForFinish } from "@/lib/card-finish";
import {
  displayableGradeRows,
  isEstimatedGradePrice,
  mergeGradeRowsByPrecedence,
} from "@/lib/market/grade-row-merge";
import {
  buildExactPrintPopulationQuery,
  cgcPopulationSearchHref,
  psaPopulationSearchHref,
} from "@/lib/market/population-search";
import {
  POPULATION_GRADER_FILTERS,
  aggregatePopulationGrades,
  getFilteredPopulationTotal,
  type PopulationGraderFilter,
} from "@/lib/population-grade-filter";
import { usesEnglishParallelPsaPopulation } from "@/lib/psa-population-attribution";
import { readSettings } from "@/lib/settings-store";
import type {
  EvidenceSummary,
  GradedPrice,
  MarketEvidence,
  MarketHistorySummary,
  MarketSourceStatus,
  PopulationBreakdown,
  PricePoint,
  PriceConsensus,
  PsaPopulationSnapshot,
  SaleRecord,
  TcgCard,
} from "@/types/pokemon";

const GRADER_FAMILIES = ["All", "Ungraded", "PSA", "BGS", "CGC", "TAG", "SGC"] as const;
const ALL_SALES_FILTER = "All";
const PREVIEW_SALE_SOURCE_PATTERN =
  /static grail preview|bundled grail preview|premium preview composite|preview model|partial cached/i;
const UNKNOWN_SOLD_DATE_LABEL = "Date Unknown";
const UNKNOWN_SOLD_PRICE_LABEL = "Price N/A";

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

  const currentIsPreview = PREVIEW_SALE_SOURCE_PATTERN.test(
    `${current.source ?? ""} ${current.note ?? ""}`,
  );

  if (currentIsPreview) {
    return true;
  }

  return live.grades.length > 0 || typeof live.totalCertified === "number" || !current.grades.length;
}

function isPreviewPopulationSnapshot(snapshot: PsaPopulationSnapshot | null) {
  if (!snapshot) {
    return false;
  }

  return PREVIEW_SALE_SOURCE_PATTERN.test(`${snapshot.source ?? ""} ${snapshot.note ?? ""}`);
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
  live: PsaPopulationSnapshot | null,
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
  return PREVIEW_SALE_SOURCE_PATTERN.test(`${price.source ?? ""} ${price.warning ?? ""}`);
}

function mergeLiveGradedPrices(current: GradedPrice[], incoming: GradedPrice[] | undefined) {
  const currentWithoutPreview = (current ?? []).filter((price) => !isPreviewGradedPrice(price));

  if (!Array.isArray(incoming) || !incoming.length) {
    return currentWithoutPreview;
  }

  return mergeGradeRowsByPrecedence(
    currentWithoutPreview,
    incoming.filter((price) => !isPreviewGradedPrice(price)),
  );
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

  return hasMarketFallbackEvidence(card) ? "No pop table" : "Unavailable";
}

function populationEmptyStateCopy(
  filter: PopulationGraderFilter,
  snapshot: PsaPopulationSnapshot,
  isLoadingLiveMarket: boolean,
  hasFallbackEvidence: boolean,
  failureCopy?: string,
) {
  if (isLoadingLiveMarket) {
    return "Checking population sources...";
  }

  const hasCgc = snapshot.grades.some((grade) => grade.grade.startsWith("CGC "));
  const hasPsa = snapshot.grades.some(
    (grade) => grade.grade.startsWith("PSA ") && !grade.grade.includes("+"),
  );

  if (filter === "psa" && hasCgc && !hasPsa) {
    return (
      snapshot.warning ??
      "No PSA census was published for this print. Switch to All or CGC to see CGC counts."
    );
  }

  if (filter === "cgc" && hasPsa && !hasCgc) {
    return "No CGC census was published for this print. Switch to All or PSA to see PSA counts.";
  }

  if (failureCopy) {
    return failureCopy;
  }

  if (hasFallbackEvidence) {
    return "No PSA/CGC population census was found for this print. Prices and sold comps below are still usable — they are not official population counts.";
  }

  return "No public population table found yet.";
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

function EstimateRange({
  estimate,
}: {
  estimate: NonNullable<GradedPrice["estimate"]>;
}) {
  return (
    <p className="mx-estimate-range">
      Range <ClientPrice amountUsd={estimate.lowUsd} /> – <ClientPrice amountUsd={estimate.highUsd} />
    </p>
  );
}

function CopyablePrintQuery({ query }: { query: string }) {
  return (
    <div className="mx-pop-search">
      <p className="mx-note">Exact-print query</p>
      <div className="mx-pop-query">
        <code>{query}</code>
        <button
          type="button"
          className="band-action"
          onClick={() => {
            void navigator.clipboard?.writeText(query);
          }}
        >
          Copy
        </button>
      </div>
      <div className="mx-pop-links">
        <a href={psaPopulationSearchHref(query)} target="_blank" rel="noreferrer">
          Search PSA population
        </a>
        <a href={cgcPopulationSearchHref(query)} target="_blank" rel="noreferrer">
          Search CGC population
        </a>
      </div>
    </div>
  );
}

function getEvidenceLabel(price: GradedPrice) {
  if (isEstimatedGradePrice(price)) {
    return "Estimate";
  }

  if (price.saleCount && price.saleCount > 0) {
    return `${price.saleCount} accepted sale${price.saleCount === 1 ? "" : "s"}`;
  }

  if (price.populationCount > 0) {
    return `Pop ${price.populationCount.toLocaleString()}`;
  }

  if (price.evidenceType === "guide_snapshot") {
    return "Price guide";
  }

  if (price.grade === "Ungraded") {
    return price.evidenceType === "catalog" ? "TCGPlayer NM catalog" : "Sold / guide";
  }

  return "Reference estimate";
}

function sourceStateClass(state?: MarketSourceStatus["state"]) {
  if (state === "ready" || state === "cached") {
    return "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";
  }
  if (state === "fallback" || state === "partial") {
    return "status-badge--medium";
  }
  if (state === "missing_credentials" || state === "disabled") {
    return "border-slate-400/25 bg-white/5 text-slate-300";
  }
  return "note-tone note-ink";
}

function sourceStateLabel(state?: MarketSourceStatus["state"]) {
  if (state === "missing_credentials") return "Needs key";
  if (state === "no_match") return "No match";
  if (state === "identity_incomplete") return "Identity incomplete";
  if (state === "circuit_open") return "API blocked";
  if (state === "timeout") return "Timed out";
  if (state === "partial") return "Loading";
  if (state === "provider_error") return "Provider error";
  if (state === "failed") return "Failed";
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
    .filter((status) => {
      if (status.source === "PokemonTCG/Cardmarket catalog") {
        return false;
      }

      if (
        sourceStatuses.some((item) => item.state === "partial") &&
        (status.state === "timeout" || status.state === "circuit_open")
      ) {
        return false;
      }

      return (
        status.state === "no_match" ||
        status.state === "failed" ||
        status.state === "timeout" ||
        status.state === "circuit_open" ||
        status.state === "provider_error" ||
        status.state === "missing_credentials" ||
        status.state === "disabled"
      );
    })
    .slice(0, 4);
  const failure = summarizeMarketSourceFailures(sourceStatuses);
  const title =
    selectedFamily !== "All" && selectedFamily !== "Ungraded"
      ? `No ${selectedFamily} slab values yet`
      : hasRawValue
        ? "No graded slab values yet"
        : "No graded market data yet";
  const detail =
    failure?.copy && failure.kind !== "api_ban"
      ? failure.copy
      : hasRawValue
        ? "Ungraded is from the card catalog. PSA/CGC rows fill in from the PokePokedex guide — binder costs and recorded sales, not PriceCharting or Collectr."
        : "No PokePokedex market row yet. Add this print to your binder with a cost, or record a sale, to start the first-party guide.";

  return (
    <div className="mx-empty">
      <p className="mx-empty-title">{title}</p>
      <p className="mx-empty-note">{detail}</p>
      {inactiveSources.length ? (
        <div className="mx-chips">
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

/**
 * The three sheets in outline, so the region keeps its shape while the
 * market resolves — bands stated, rules drawn, figures pending.
 */
function GradedMarketLoadingSkeleton() {
  const gradeRows = Array.from({ length: 4 }, (_, index) => index);
  const popRows = Array.from({ length: 6 }, (_, index) => index);

  return (
    <div className="mx-grid">
      <section className="sheet mx-sheet mx-grades" aria-hidden="true">
        <header className="sheet-band">
          <h2 className="sheet-band-title">Grade values</h2>
        </header>
        <div className="mx-selected">
          <p className="mx-label">Selected</p>
          <span className="mx-skeleton-bar mx-skeleton-bar--lg mt-3 w-32" />
          <span className="mx-skeleton-bar mt-3 w-20" />
        </div>
        <div className="mx-table-head">
          <span>Grade</span>
          <span>Value</span>
        </div>
        <div className="mx-table">
          {gradeRows.map((row) => (
            <div key={row} className="mx-row">
              <span className="mx-skeleton-bar w-28" />
              <span className="mx-skeleton-bar w-16" />
            </div>
          ))}
        </div>
      </section>

      <div className="mx-col">
        <section className="sheet mx-sheet mx-chart" aria-hidden="true">
          <header className="sheet-band">
            <h2 className="sheet-band-title">Price chart</h2>
          </header>
          <div className="mx-chart-body">
            <div className="mx-plot h-44 sm:h-52" />
          </div>
        </section>

        <section className="sheet mx-sheet mx-pop" aria-hidden="true">
          <header className="sheet-band">
            <h2 className="sheet-band-title">Population</h2>
          </header>
          <div className="mx-pop-lead">
            <div className="mx-pop-total">
              <p className="mx-label">Total</p>
              <span className="mx-skeleton-bar mx-skeleton-bar--lg mt-3 w-24" />
            </div>
          </div>
          <div className="mx-pop-grades">
            {popRows.map((row) => (
              <div key={row} className="mx-pop-cell">
                <span className="mx-skeleton-bar w-12" />
                <span className="mx-skeleton-bar w-10" />
              </div>
            ))}
          </div>
        </section>
      </div>
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
  const [salesFilter, setSalesFilter] = useState<string>(ALL_SALES_FILTER);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const displayCard = sharedMarket?.enrichedCard ?? liveCard;
  const resolvedLoadingFullMarket =
    managedMarket?.isLoadingFullMarket ?? sharedMarket?.isLoadingFull ?? false;
  const hasVisibleMarketValue =
    (sharedMarket?.enrichedCard ?? liveCard).gradedPrices.some((price) => (price.value ?? 0) > 0) ||
    hasPopulationSignal((sharedMarket?.enrichedCard ?? liveCard).psaPopulation);
  const resolvedLoadingLiveMarket =
    managedMarket?.isLoadingLiveMarket ??
    (sharedMarket
      ? Boolean(sharedMarket.isLoadingCore && !hasVisibleMarketValue)
      : isLoadingLiveMarket);
  const isCheckingGradeValues =
    (Boolean(sharedMarket?.isLoadingCore) || resolvedLoadingLiveMarket) &&
    !resolvedLoadingFullMarket;
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
    }, CARD_DETAIL_FIRST_PAINT_CLIENT_MS);
    type GradingMarketResponse = {
      timedOut?: boolean;
      status?: string;
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
    };

    const applyData = (data: GradingMarketResponse | null) => {
      if (!data || controller.signal.aborted || !shouldApplyLiveMarketPayload(data)) {
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
          priceHistory: mergePriceHistory(current.priceHistory, data.priceHistory ?? []),
          marketHistory: nextMarketHistory,
          marketHistoryStatus: nextMarketHistory?.status ?? current.marketHistoryStatus,
          historyUnavailable:
            nextMarketHistory?.historyUnavailable ?? current.historyUnavailable,
          populationBreakdown: data.populationBreakdown ?? current.populationBreakdown,
          recentSales: mergeLiveRecentSales(current.recentSales ?? [], data.recentSales),
          evidenceSummary: data.evidenceSummary ?? current.evidenceSummary,
          sourceStatus: data.sourceStatus ?? data.evidenceSummary?.sourceStatus ?? current.sourceStatus,
          marketEvidence: data.marketEvidence ?? current.marketEvidence,
          priceConsensus: nextConsensus ?? current.priceConsensus,
        };
        mergedCard.marketPriceUsd = getHeadlineMarketPriceUsd(mergedCard);

        const headline = mergedCard.marketPriceUsd;
        if (headline > 0) {
          let sawUngraded = false;
          mergedCard.gradedPrices = mergedCard.gradedPrices.map((price) => {
            if (price.grade !== "Ungraded") {
              return price;
            }
            sawUngraded = true;
            return price.value === headline ? price : { ...price, value: headline };
          });
          if (!sawUngraded) {
            mergedCard.gradedPrices = [
              {
                grade: "Ungraded",
                value: headline,
                populationCount: 0,
                service: "RAW",
                confidence: mergedCard.priceConsensus?.confidence ?? "medium",
                confidenceScore: mergedCard.priceConsensus?.confidenceScore,
                evidenceType: "guide_snapshot",
              },
              ...mergedCard.gradedPrices,
            ];
          }
          if (mergedCard.priceConsensus) {
            mergedCard.priceConsensus = {
              ...mergedCard.priceConsensus,
              finalEstimateUsd: headline,
            };
          }
        }

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

    void fetchPhase("core").finally(() => {
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
    const displayable = displayableGradeRows(displayCard.gradedPrices);
    if (selectedFamily === "All") {
      return displayable;
    }

    return displayable.filter((price) => getGradeFamily(price.grade) === selectedFamily);
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
  const hasRawGradeValue = displayCard.gradedPrices.some(
    (price) => price.grade === "Ungraded" && hasPriceValue(price.value),
  );
  const hasSlabGradeValues = displayCard.gradedPrices.some(
    (price) => price.grade !== "Ungraded" && hasPriceValue(price.value),
  );
  const selectedFamilyHasValues = visibleGrades.some((price) => hasPriceValue(price.value));
  const shouldShowGradeValuesEmptyState =
    selectedFamily === "All"
      ? !hasRawGradeValue && !hasSlabGradeValues
      : !selectedFamilyHasValues;
  const isRefreshingMarket =
    resolvedLoadingLiveMarket ||
    Boolean(sharedMarket?.isLoadingCore) ||
    resolvedLoadingFullMarket;
  const populationHasSignal = hasPopulationSignal(displayCard.psaPopulation);
  const englishParallelPopulation = displayCard.populationBreakdown?.englishParallel;
  const englishParallelTotal = englishParallelPopulation
    ? getFilteredPopulationTotal(
        englishParallelPopulation.grades,
        "all",
        englishParallelPopulation.totalCertified,
      )
    : null;
  const populationSourceSummary = getPopulationSourceSummary(displayCard.psaPopulation);
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
  const soldComps = useMemo(
    () =>
      filterSalesForFinish(
        Array.isArray(displayCard.recentSales) ? displayCard.recentSales : [],
        displayCard.finish,
      ),
    [displayCard.finish, displayCard.recentSales],
  );

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
  const visibleSales = sales;
  const hasDeferredSources = sourceStatuses.some((status) => status.state === "partial");
  const visibleSourceStatuses = sourceStatuses.filter((status) => {
    if (
      hasDeferredSources &&
      (status.state === "timeout" || status.state === "circuit_open")
    ) {
      return false;
    }

    return (
      status.state === "ready" ||
      status.state === "cached" ||
      status.state === "fallback" ||
      status.state === "timeout" ||
      status.state === "circuit_open" ||
      status.state === "provider_error" ||
      status.state === "failed"
    );
  });
  const sourceFailure = summarizeMarketSourceFailures(sourceStatuses);
  const populationIsEstimated = populationSourceSummary.isEnglishParallelEstimate;
  // A census count is a figure; "No pop table" is a stated absence. Setting the
  // second at display weight made a missing census read as the loudest number
  // on the sheet, which is the same mistake the raw market column already fixed
  // for "Market pending".
  const populationTotalIsCount = typeof filteredPopulationTotal === "number";
  const populationTotalLabel = populationTotalIsCount
    ? filteredPopulationTotal.toLocaleString()
    : populationGraderFilter === "all"
      ? getPopulationTotalLabel(displayCard, isRefreshingMarket)
      : resolvedLoadingLiveMarket
        ? "Checking"
        : "—";

  const openSalesModal = () => {
    requestFullMarket?.();
    setIsSalesModalOpen(true);
  };

  if (resolvedLoadingLiveMarket) {
    return <GradedMarketLoadingSkeleton />;
  }

  return (
    <>
    <div className="mx-grid">
        <section
          id="graded-prices"
          className="sheet mx-sheet mx-grades"
        >
          <header className="sheet-band">
            <h2 className="sheet-band-title">Grade values</h2>
            <div className="band-tools">
              <div className="band-seg" role="group" aria-label="Grader family">
                {GRADER_FAMILIES.filter((family) => {
                  if (family === "All") {
                    return true;
                  }

                  return displayableGradeRows(displayCard.gradedPrices).some(
                    (price) => getGradeFamily(price.grade) === family,
                  );
                }).map((family) => (
                  <button
                    key={family}
                    type="button"
                    onClick={() => setSelectedFamily(family)}
                    aria-pressed={selectedFamily === family}
                    className="band-seg-btn"
                  >
                    {family}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {selectedPrice ? (
            <div className="mx-selected">
              <p className="mx-label">Selected</p>
              <p className="mx-selected-grade">{selectedPrice.grade}</p>
              <GradePriceValue
                value={selectedPrice.value}
                className="mx-selected-figure"
              />
              {selectedPrice.estimate ? <EstimateRange estimate={selectedPrice.estimate} /> : null}
              <p className="mx-selected-note">
                <span>{getEvidenceLabel(selectedPrice)}</span>
                {isEstimatedGradePrice(selectedPrice) ? (
                  <span className="mx-flag">Estimate</span>
                ) : selectedPrice.warning ? (
                  <span className="mx-flag">Thin evidence</span>
                ) : null}
              </p>
              {selectedPrice.estimate ? (
                <p className="mx-selected-sub">
                  {selectedPrice.estimate.confidence === "low" ? "Low confidence. " : "Medium confidence. "}
                  {selectedPrice.estimate.explanation}
                </p>
              ) : null}
              {selectedPrice.grade === "Ungraded" &&
              shouldShowNmSecondary(selectedPrice.value, displayCard.nmMarketUsd) ? (
                <p className="mx-selected-sub">
                  TCGPlayer NM{" "}
                  <ClientPrice amountUsd={displayCard.nmMarketUsd!} />
                </p>
              ) : null}
            </div>
          ) : null}

          {visibleGrades.length ? (
            <>
              <div className="mx-table-head">
                <span>Grade</span>
                <span>Value</span>
              </div>
              <div className="mx-table">
                {visibleGrades.map((price) => {
                  const isSelected = price.grade === activeSelectedGrade;

                  return (
                    <button
                      key={price.grade}
                      type="button"
                      onClick={() => setSelectedGrade(price.grade)}
                      aria-pressed={isSelected}
                      className="mx-row"
                    >
                      <span className="mx-row-grade">
                        {price.grade}
                        <span className="mx-row-note">{getEvidenceLabel(price)}</span>
                      </span>
                      <span className="mx-row-value-stack">
                        <GradePriceValue value={price.value} className="mx-row-value" />
                        {price.estimate ? (
                          <span className="mx-row-range">
                            <ClientPrice amountUsd={price.estimate.lowUsd} />–<ClientPrice amountUsd={price.estimate.highUsd} />
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {isCheckingGradeValues && hasRawGradeValue && !hasSlabGradeValues ? (
            <p className="mx-empty-note">Looking up PSA, BGS, and CGC slab values…</p>
          ) : null}

          {shouldShowGradeValuesEmptyState ? (
            isCheckingGradeValues ? (
              <div className="mx-empty">
                <p className="mx-empty-title">Checking graded values</p>
                <p className="mx-empty-note">
                  Loading PSA, BGS, CGC, TAG, and SGC rows for this print.
                </p>
              </div>
            ) : (
              <GradeValuesEmptyState
                selectedFamily={selectedFamily}
                hasRawValue={hasRawGradeValue}
                sourceStatuses={sourceStatuses}
              />
            )
          ) : null}

          {displayCard.evidenceSummary ? (
            <dl className="mx-evidence">
              <div>
                <dt>Accepted</dt>
                <dd>{displayCard.evidenceSummary.accepted}</dd>
              </div>
              <div>
                <dt>Rejected</dt>
                <dd>{displayCard.evidenceSummary.rejected}</dd>
              </div>
              <div>
                <dt>Thin</dt>
                <dd>{displayCard.evidenceSummary.thin}</dd>
              </div>
              <div>
                <dt>Fallback</dt>
                <dd>{displayCard.evidenceSummary.fallback}</dd>
              </div>
            </dl>
          ) : null}

          <div className="mx-comps-head">
            <div className="min-w-0">
              <p className="mx-label">Sold comps</p>
              <p className="mx-note">
                {allSales.length
                  ? `${allSales.length} accepted comp${allSales.length === 1 ? "" : "s"}`
                  : resolvedLoadingFullMarket
                    ? "Checking sold listings..."
                    : sourceFailure?.copy ?? "None available yet"}
              </p>
            </div>
            <button
              type="button"
              onClick={openSalesModal}
              disabled={resolvedLoadingFullMarket && !allSales.length}
              className="band-action"
            >
              {resolvedLoadingFullMarket && !allSales.length ? "Loading" : "Expand"}
            </button>
          </div>

          {visibleSales.length ? (
            <ul className="mx-comp-list">
              {visibleSales.map((sale) => (
                <li
                  key={`${sale.displayDate}-${sale.title}-${sale.displayPrice ?? UNKNOWN_SOLD_PRICE_LABEL}-${sale.condition}`}
                  className="mx-comp"
                >
                  <p className="mx-comp-title">{sale.title}</p>
                  {sale.displayPrice == null ? (
                    <span className="mx-comp-value">{UNKNOWN_SOLD_PRICE_LABEL}</span>
                  ) : (
                    <GradePriceValue
                      value={sale.displayPrice}
                      className="mx-comp-value"
                    />
                  )}
                  <p className="mx-comp-meta">
                    {sale.condition} · {sale.displayDate}
                  </p>
                </li>
              ))}
            </ul>
          ) : resolvedLoadingFullMarket ? (
            <div className="mx-block">
              <p className="mx-note">Checking sold listings...</p>
            </div>
          ) : null}

          {(displayCard.activeListings?.length ?? 0) > 0 ? (
            <div className="mx-block">
              <p className="mx-label">For sale now</p>
              <p className="mx-note">Active eBay asks used only to validate estimates. These are not sold comps.</p>
              <ul className="mx-comp-list">
                {displayCard.activeListings!.slice(0, 6).map((listing) => (
                  <li key={`${listing.listingUrl ?? listing.title}-${listing.priceUsd}`} className="mx-comp">
                    {listing.listingUrl ? (
                      <a className="mx-comp-title" href={listing.listingUrl} target="_blank" rel="noreferrer">
                        {listing.title}
                      </a>
                    ) : (
                      <p className="mx-comp-title">{listing.title}</p>
                    )}
                    <GradePriceValue value={listing.priceUsd} className="mx-comp-value" />
                    <p className="mx-comp-meta">
                      {listing.grade} · {listing.source}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <div className="mx-col">
          <div className="mx-chart-host">
            <PriceChart
              embedded
              points={displayCard.priceHistory}
              recentSales={displayCard.recentSales}
              selectedGrade={activeSelectedGrade}
              snapshotAmountUsd={selectedPrice?.value}
              gradedPrices={displayCard.gradedPrices}
              marketHistory={displayCard.marketHistory}
              visibleGradeLabels={visibleGrades.map((price) => price.grade)}
              onSelectGrade={setSelectedGrade}
            />
          </div>

          <section className="sheet mx-sheet mx-pop">
            <header className="sheet-band">
              <h2 className="sheet-band-title">
                {displayCard.language === "ja" ? "Japanese population" : "Population"}
              </h2>
              {populationHasSignal && displayCard.psaPopulation.grades.length ? (
                <div className="band-tools">
                  <div
                    className="band-seg"
                    role="group"
                    aria-label="Population grader filter"
                  >
                    {POPULATION_GRADER_FILTERS.map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setPopulationGraderFilter(filter)}
                        aria-pressed={populationGraderFilter === filter}
                        className="band-seg-btn"
                      >
                        {populationGraderFilterLabel(filter)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </header>

            <div className="mx-pop-lead">
              <div className="mx-pop-total">
                <p className="mx-label">Total</p>
                {populationTotalIsCount ? (
                  <p className="mx-figure">{populationTotalLabel}</p>
                ) : (
                  <p className="mx-figure-absent">{populationTotalLabel}</p>
                )}
                {populationIsEstimated ? (
                  <span className="mx-flag">Estimated</span>
                ) : null}
              </div>

              <div className="mx-pop-source">
                {populationHasSignal ? (
                  <p className="mx-note">Source: {populationSourceSummary.source}</p>
                ) : null}
                {visibleSourceStatuses.length ? (
                  <div className="mx-chips">
                    {visibleSourceStatuses.slice(0, 6).map((status) => (
                      <span
                        key={`${status.source}-${status.state}`}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${sourceStateClass(status.state)}`}
                      >
                        {sourceStateLabel(status.state)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {populationSourceSummary.isEnglishParallelEstimate ? (
              <div className="mx-block">
                <p className="mx-note">
                  {displayCard.psaPopulation.warning ??
                    "PSA population reflects the English parallel release because Japanese PSA submissions are minimal in public census data."}
                </p>
              </div>
            ) : populationSourceSummary.isCombinedEstimate ? (
              <div className="mx-block">
                <p className="mx-note">
                  {displayCard.psaPopulation.warning ??
                    "Set-index population rows combine PSA and CGC counts for grades 6-10."}
                </p>
              </div>
            ) : displayCard.psaPopulation.warning &&
              populationGraderFilter === "all" &&
              !isRefreshingMarket ? (
              <div className="mx-block">
                <p className="mx-note">{displayCard.psaPopulation.warning}</p>
              </div>
            ) : null}

            {englishParallelPopulation ? (
              <div className="mx-block">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="mx-label">English parallel-set PSA population</p>
                  <span className="mx-comp-value">
                    {typeof englishParallelTotal === "number"
                      ? englishParallelTotal.toLocaleString()
                      : "Unavailable"}
                  </span>
                </div>
                <p className="mx-note mt-2">
                  {englishParallelPopulation.mappedFromSet}. Supplemental reference
                  only; these counts are not included in the Japanese census total.
                </p>
              </div>
            ) : null}

            {populationHasSignal && filteredPopulationGrades.length ? (
              <div className="mx-pop-grades">
                {filteredPopulationGrades.map((grade) => (
                  <div key={grade.grade} className="mx-pop-cell">
                    <span className="mx-pop-grade">{grade.grade}</span>
                    <span className="mx-pop-count">
                      {typeof grade.count === "number"
                        ? grade.count.toLocaleString()
                        : "No data"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mx-empty">
                <p className="mx-empty-note">
                  {populationEmptyStateCopy(
                    populationGraderFilter,
                    displayCard.psaPopulation,
                    isRefreshingMarket,
                    hasMarketFallbackEvidence(displayCard),
                    sourceFailure?.copy,
                  )}
                </p>
                {!isRefreshingMarket ? (
                  <CopyablePrintQuery query={buildExactPrintPopulationQuery(displayCard)} />
                ) : null}
                {!isRefreshingMarket &&
                !filteredPopulationGrades.length &&
                populationGraderFilter === "all" &&
                populationFallbackStats.length ? (
                  <dl className="mx-inline-stats">
                    {populationFallbackStats.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value.toLocaleString()}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            )}
          </section>
        </div>
    </div>
      {isSalesModalOpen ? (
        <div
          className="mx-modal-scrim"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sold-comps-title"
        >
          <div className="sheet mx-sheet mx-modal">
            <header className="sheet-band mx-modal-band">
              <div className="min-w-0">
                <h2 id="sold-comps-title" className="sheet-band-title">
                  Last sold listings
                </h2>
                <p className="mx-note mt-2">
                  Showing{" "}
                  {visibleSales.length
                    ? `${visibleSales.length} recent accepted comp${visibleSales.length === 1 ? "" : "s"}`
                    : "recent accepted comps"}
                  {activeSalesFilter === ALL_SALES_FILTER ? "." : ` for ${activeSalesFilter}.`}
                </p>
              </div>
              <div className="mx-modal-tools">
                <label className="mx-modal-filter">
                  <span id="sold-comps-grade-label" className="mx-label">
                    Sold grade
                  </span>
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
                  className="band-action"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="sold-comps-scroll mx-modal-body">
              {shouldShowAllSalesFallback ? (
                <div className="mx-block">
                  <p className="mx-note">
                    No {requestedSalesFilter} sold listings passed the trust checks
                    yet. Showing all accepted comps instead.
                  </p>
                </div>
              ) : null}

              {visibleSales.length ? (
                <ul className="mx-sale-list">
                  {visibleSales.map((sale) => {
                    const isSelected =
                      sale.condition === activeSalesFilter ||
                      (activeSalesFilter === ALL_SALES_FILTER &&
                        sale.condition === activeSelectedGrade);

                    return (
                      <li
                        key={`${sale.displayDate}-${sale.title}-${sale.displayPrice ?? UNKNOWN_SOLD_PRICE_LABEL}-${sale.condition}-modal`}
                        className="mx-sale"
                        aria-current={isSelected || undefined}
                      >
                        <div className="mx-sale-lead">
                          <p className="mx-sale-title">{sale.title}</p>
                          <p className="mx-sale-meta">
                            {sale.condition} · {sale.source}
                            {sale.seller ? ` · ${sale.seller}` : ""}
                          </p>
                          {sale.warning ? (
                            <p className="mx-sale-warning">{sale.warning}</p>
                          ) : null}
                        </div>
                        {sale.displayPrice == null ? (
                          <span className="mx-sale-value">{UNKNOWN_SOLD_PRICE_LABEL}</span>
                        ) : (
                          <ClientPrice
                            amountUsd={sale.displayPrice}
                            className="mx-sale-value"
                          />
                        )}
                        <p className="mx-sale-date">{sale.displayDate}</p>
                        {sale.listingUrl ? (
                          <a
                            href={sale.listingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mx-sale-link"
                          >
                            View listing
                          </a>
                        ) : (
                          <span className="mx-sale-nolink">Listing link unavailable</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mx-empty">
                  <p className="mx-empty-note">
                    {resolvedLoadingFullMarket
                      ? "Checking sold listings..."
                      : "No recent sales records found."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
    ) : null}
    </>
  );
}
