"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import { ClientPrice, CurrencyLabel } from "@/components/client-price";
import { HoloTilt } from "@/components/fx/holo-tilt";
import { usePrintOnView } from "@/components/fx/use-print-on-view";
import {
  FlatMark,
  PlusMark,
  SortMark,
  TrendMark,
} from "@/components/icons/ledger-icons";
import { BinderInsights } from "@/components/portfolio/binder-insights";
import {
  type BinderAnalyticsItem,
  aggregatePortfolioHistory,
  getHistoryValue,
  portfolioDayMovePercent,
  unrealizedPnl,
} from "@/lib/binder-analytics";
import {
  clearPortfolioValueHistory,
  portfolioValueHistoryToPoints,
  readPortfolioValueHistory,
  recordPortfolioValueSnapshot,
} from "@/lib/portfolio-value-history";
import {
  buildBinderMarketSearchParams,
  buildBinderPriceSearchParams,
  hasTrackedCost,
  positivePrice,
  resolveBinderGradeMarket,
  shouldRefreshBinderMarket,
} from "@/lib/binder-market";
import { contributeHoldingMarket } from "@/lib/market/pokedex-market-client";
import { isUsableMarketPriceUsd } from "@/lib/market/pokedex-market-guide";
import { stashPortfolioItemForNavigation } from "@/lib/client-catalog-cache";
import { getCards } from "@/lib/cards";
import {
  portfolioItemKey,
  readPortfolio,
  subscribeToPortfolio,
  writePortfolio,
} from "@/lib/portfolio-store";
import type { GradedPrice, PortfolioItem, PriceConsensus } from "@/types/pokemon";

const EMPTY_PORTFOLIO_ITEMS: PortfolioItem[] = [];
const BINDER_MARKET_CONCURRENCY = 2;

async function settleWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = { status: "fulfilled", value: await worker(values[index]) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    },
  );

  await Promise.all(workers);
  return results;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

type BinderSortKey = "recent" | "value" | "pl" | "name";
type BinderRecentDirection = "newest" | "oldest";
type BinderGradeFilter = "all" | "graded" | "ungraded";

const SORT_OPTIONS: Array<{ key: BinderSortKey; label: string }> = [
  { key: "value", label: "Value" },
  { key: "pl", label: "P/L" },
  { key: "name", label: "A–Z" },
];

const GRADE_FILTER_OPTIONS: Array<{ key: BinderGradeFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "graded", label: "Graded" },
  { key: "ungraded", label: "Ungraded" },
];

/** Row indices only mean something when the sort order ranks them. */
const RANKED_SORTS: BinderSortKey[] = ["value", "pl"];

function trendDirection(value: number, tracked = true) {
  if (!tracked || Math.abs(value) < 0.005) {
    return "flat" as const;
  }

  return value > 0 ? ("up" as const) : ("down" as const);
}

function subscribeMounted() {
  return () => undefined;
}

function getMounted() {
  return true;
}

function getServerMounted() {
  return false;
}

/**
 * Shimmering dark-grid placeholder shown until the client has hydrated (and the
 * portfolio store is readable). Rendering this instead of the live dashboard
 * during hydration means the heavy value/P-L aggregation never blocks the first
 * paint, so users drop into a loading layout instead of a frozen screen.
 */
function BinderDashboardSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-7" aria-hidden="true">
      <section className="sheet registry">
        <div className="sheet-band">
          <span className="sheet-band-title">Portfolio</span>
        </div>
        <div className="registry-body">
          <div className="registry-lead">
            <div className="h-3 w-24 animate-pulse rounded-sm bg-white/10" />
            <div className="mt-4 h-12 w-56 max-w-full animate-pulse rounded-sm bg-white/8" />
            <div className="mt-6 h-5 w-full animate-pulse rounded-sm bg-white/6" />
          </div>
          <dl className="registry-side">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index}>
                <div className="h-3 w-28 animate-pulse rounded-sm bg-white/10" />
                <div className="mt-3 h-6 w-36 max-w-full animate-pulse rounded-sm bg-white/8" />
              </div>
            ))}
          </dl>
        </div>
      </section>
      <section className="sheet ledger">
        <div className="sheet-band">
          <span className="sheet-band-title">Holdings ledger</span>
        </div>
        <div className="ledger-empty">
          <div className="mx-auto h-3 w-48 animate-pulse rounded-sm bg-white/8" />
        </div>
      </section>
    </div>
  );
}

export function PortfolioClient() {
  const router = useRouter();
  const [openActionKey, setOpenActionKey] = useState<string | null>(null);
  const [drawerNotice, setDrawerNotice] = useState("");
  const mounted = useSyncExternalStore(subscribeMounted, getMounted, getServerMounted);
  const [sortKey, setSortKey] = useState<BinderSortKey>("recent");
  const [recentDirection, setRecentDirection] = useState<BinderRecentDirection>("newest");
  const [gradeFilter, setGradeFilter] = useState<BinderGradeFilter>("all");

  const { ref: registryRef, phase: registryPhase } = usePrintOnView<HTMLElement>();
  const { ref: ledgerRef, phase: ledgerPhase } = usePrintOnView<HTMLElement>();

  const [marketOverrides, setMarketOverrides] = useState<
    Record<string, { value: number; source?: string; fetchedAt: string }>
  >({});
  const items = useSyncExternalStore(
    subscribeToPortfolio,
    readPortfolio,
    () => EMPTY_PORTFOLIO_ITEMS,
  );

  useEffect(() => {
    if (!items.length) {
      return;
    }

    const controller = new AbortController();
    const cards = getCards();
    if (!items.some((item) => shouldRefreshBinderMarket(item))) {
      return;
    }

    settleWithConcurrency(
      items,
      BINDER_MARKET_CONCURRENCY,
      async (item) => {
        const key = portfolioItemKey(item);

        if (!shouldRefreshBinderMarket(item)) {
          const cachedValue = positivePrice(item.marketValueUsd);

          if (!cachedValue) {
            return null;
          }

          return {
            key,
            value: cachedValue,
            source: item.marketSource,
            persist: false,
          };
        }

        const localCard = cards.find((card) => card.id === item.cardId || card.slug === item.slug);
        const localResolved = resolveBinderGradeMarket(
          item.grade,
          localCard?.gradedPrices,
          localCard?.priceConsensus,
        );

        if (localResolved.value) {
          return {
            key,
            value: localResolved.value,
            source: localResolved.source ?? "Local catalog market",
            persist: true,
          };
        }

        const isUngraded = item.grade === "Ungraded";
        const endpoint = isUngraded
          ? `/api/price?${buildBinderPriceSearchParams(item, localCard).toString()}`
          : `/api/grading-market?${buildBinderMarketSearchParams(item, localCard).toString()}`;
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          return null;
        }

        const data = (await response.json()) as {
          ungradedUsd?: number;
          gradedPrices?: GradedPrice[];
          priceConsensus?: PriceConsensus;
        };
        if (isUngraded) {
          const value = positivePrice(data.ungradedUsd);
          return value
            ? {
                key,
                value,
                source: "Cache-first market price",
                persist: true,
              }
            : null;
        }
        const resolved = resolveBinderGradeMarket(
          item.grade,
          data.gradedPrices,
          data.priceConsensus,
        );

        if (!resolved.value) {
          return null;
        }

        return {
          key,
          value: resolved.value,
          source: resolved.source ?? data.priceConsensus?.methodology,
          persist: true,
        };
      },
    ).then((results) => {
      if (controller.signal.aborted) {
        return;
      }

      const nextOverrides: Record<string, { value: number; source?: string; fetchedAt: string }> =
        {};
      const persistedKeys = new Set<string>();
      const fetchedAt = new Date().toISOString();

      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value) {
          continue;
        }

        nextOverrides[result.value.key] = {
          value: result.value.value,
          source: result.value.source,
          fetchedAt,
        };

        if (result.value.persist) {
          persistedKeys.add(result.value.key);
        }
      }

      if (Object.keys(nextOverrides).length) {
        setMarketOverrides((current) => ({ ...current, ...nextOverrides }));
      }

      if (persistedKeys.size) {
        let changed = false;
        const nextItems = items.map((item) => {
          const key = portfolioItemKey(item);
          const fetched = nextOverrides[key];

          if (!fetched || !persistedKeys.has(key)) {
            return item;
          }

          const existingValue = positivePrice(item.marketValueUsd);

          if (
            existingValue &&
            Math.abs(existingValue - fetched.value) < 0.01 &&
            item.marketSource === fetched.source
          ) {
            return item;
          }

          changed = true;
          return {
            ...item,
            marketValueUsd: fetched.value,
            marketValueUpdatedAt: fetchedAt,
            marketSource: fetched.source ?? item.marketSource,
          };
        });

        // Only persist when a value truly changed. Writing an identically-shaped
        // array still swaps the store's reference, which re-fires this [items]
        // effect; because unchanged items keep their stale refresh timestamp,
        // shouldRefreshBinderMarket stays true and the effect spins into an
        // infinite fetch/render loop (the "stuck on rendering" hang). Guarding on
        // a real change breaks that cycle.
        if (changed) {
          writePortfolio(nextItems);
        }
      }
    });

    return () => controller.abort();
  }, [items]);

  const enrichedItems = useMemo(() => {
    const cards = getCards();

    return items.map((item) => {
      const itemKey = portfolioItemKey(item);
      const liveCard = cards.find((card) => card.id === item.cardId || card.slug === item.slug);
      const overrideMarketValue = positivePrice(marketOverrides[itemKey]?.value);
      const capturedMarketValue = positivePrice(item.marketValueUsd);
      const catalogResolved = resolveBinderGradeMarket(
        item.grade,
        liveCard?.gradedPrices,
        liveCard?.priceConsensus,
      );
      const catalogMarketValue = positivePrice(catalogResolved.value);
      const currentValueUsd =
        overrideMarketValue ?? capturedMarketValue ?? catalogMarketValue ?? 0;
      const isMarketPending = shouldRefreshBinderMarket(item) && currentValueUsd <= 0;
      const history = liveCard?.priceHistory ?? [];
      const lastHistoryPoint = [...history]
        .reverse()
        .find((point) => getHistoryValue(point, item.grade));
      const previousHistoryPoint = [...history]
        .reverse()
        .find(
          (point) =>
            getHistoryValue(point, item.grade) &&
            point.date !== lastHistoryPoint?.date,
        );
      const lastHistoryValue = lastHistoryPoint
        ? getHistoryValue(lastHistoryPoint, item.grade)
        : undefined;
      const previousHistoryValue = previousHistoryPoint
        ? getHistoryValue(previousHistoryPoint, item.grade)
        : undefined;
      const hasDayMove =
        typeof lastHistoryValue === "number" &&
        typeof previousHistoryValue === "number" &&
        previousHistoryValue > 0;
      const dayChangeUsd = hasDayMove ? lastHistoryValue - previousHistoryValue : 0;
      const dayChangePercent = hasDayMove ? (dayChangeUsd / previousHistoryValue) * 100 : 0;
      const itemHasTrackedCost = hasTrackedCost(item.costBasisUsd);
      const totalCostUsd = item.costBasisUsd * item.quantity;
      const totalCurrentUsd = currentValueUsd * item.quantity;
      const { gainLossUsd, gainLossPercent } = itemHasTrackedCost
        ? unrealizedPnl(totalCurrentUsd, totalCostUsd)
        : { gainLossUsd: 0, gainLossPercent: null as number | null };
      const marketSource =
        marketOverrides[itemKey]?.source ??
        item.marketSource ??
        catalogResolved.source ??
        (catalogMarketValue ? "Local catalog market" : undefined);

      return {
        ...item,
        catalogCard: liveCard,
        currentValueUsd,
        dayChangePercent,
        dayChangeUsd,
        gainLossPercent,
        gainLossUsd,
        isMarketPending,
        rarity: item.rarity ?? liveCard?.rarity ?? "Tracked card",
        setCode: item.setCode ?? liveCard?.setCode ?? "",
        marketSource,
        totalCostUsd,
        totalCurrentUsd,
        hasTrackedCost: itemHasTrackedCost,
      };
    });
  }, [items, marketOverrides]);

  // All portfolio totals in a single memoized pass so this aggregation only
  // recomputes when the holdings (or their resolved values) actually change —
  // never on unrelated re-renders (sort, filter, drawer open, hover, etc.).
  const {
    totalValueUsd,
    trackedCostUsd,
    trackedCurrentValueUsd,
    gainLossUsd,
    gainLossPercent,
    totalDayChangeUsd,
  } = useMemo(() => {
    let totalValue = 0;
    let trackedCost = 0;
    let trackedCurrent = 0;
    let dayChange = 0;

    for (const item of enrichedItems) {
      totalValue += item.currentValueUsd * item.quantity;
      dayChange += item.dayChangeUsd * item.quantity;

      if (item.hasTrackedCost) {
        trackedCost += item.costBasisUsd * item.quantity;
        trackedCurrent += item.totalCurrentUsd;
      }
    }

    const gainLoss = unrealizedPnl(trackedCurrent, trackedCost);

    return {
      totalValueUsd: totalValue,
      trackedCostUsd: trackedCost,
      trackedCurrentValueUsd: trackedCurrent,
      gainLossUsd: gainLoss.gainLossUsd,
      gainLossPercent: gainLoss.gainLossPercent,
      totalDayChangeUsd: dayChange,
    };
  }, [enrichedItems]);

  const analyticsItems = useMemo<BinderAnalyticsItem[]>(
    () =>
      enrichedItems.map((item) => ({
        cardId: item.cardId,
        slug: item.slug,
        name: item.name,
        image: item.image,
        grade: item.grade,
        rarity: item.rarity,
        setName: item.setName,
        setCode: item.setCode,
        quantity: item.quantity,
        currentValueUsd: item.currentValueUsd,
        totalCurrentUsd: item.totalCurrentUsd,
        costBasisUsd: item.costBasisUsd,
        totalCostUsd: item.totalCostUsd,
        gainLossUsd: item.gainLossUsd,
        gainLossPercent: item.gainLossPercent,
        dayChangeUsd: item.dayChangeUsd,
        dayChangePercent: item.dayChangePercent,
        hasTrackedCost: item.hasTrackedCost,
        priceHistory: item.catalogCard?.priceHistory,
        addedAt: item.addedAt,
      })),
    [enrichedItems],
  );

  const holdingsCount = useMemo(
    () => enrichedItems.reduce((sum, item) => sum + item.quantity, 0),
    [enrichedItems],
  );

  const [trendHistoryVersion, setTrendHistoryVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!analyticsItems.length) {
      if (readPortfolioValueHistory().length) {
        clearPortfolioValueHistory();
        setTrendHistoryVersion((current) => current + 1);
      }
      return;
    }

    if (totalValueUsd <= 0) {
      return;
    }

    const before = readPortfolioValueHistory();
    const after = recordPortfolioValueSnapshot({
      valueUsd: totalValueUsd,
      holdings: holdingsCount,
      items: analyticsItems.map((item) => ({
        addedAt: item.addedAt ?? "",
        quantity: item.quantity,
        currentValueUsd: item.currentValueUsd,
      })),
    });

    const beforeTail = before[before.length - 1];
    const afterTail = after[after.length - 1];
    const changed =
      before.length !== after.length ||
      beforeTail?.date !== afterTail?.date ||
      beforeTail?.valueUsd !== afterTail?.valueUsd ||
      beforeTail?.holdings !== afterTail?.holdings;

    if (changed) {
      setTrendHistoryVersion((current) => current + 1);
    }
  }, [analyticsItems, holdingsCount, totalValueUsd]);

  const portfolioHistory = useMemo(() => {
    if (typeof window === "undefined") {
      return aggregatePortfolioHistory(analyticsItems);
    }

    const persisted = portfolioValueHistoryToPoints(readPortfolioValueHistory());
    if (persisted.length >= 2) {
      return persisted;
    }

    return aggregatePortfolioHistory(analyticsItems);
    // trendHistoryVersion forces a re-read after localStorage snapshots update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyticsItems, trendHistoryVersion]);

  const filteredItems = useMemo(() => {
    switch (gradeFilter) {
      case "graded":
        return enrichedItems.filter((item) => item.grade !== "Ungraded");
      case "ungraded":
        return enrichedItems.filter((item) => item.grade === "Ungraded");
      default:
        return enrichedItems;
    }
  }, [enrichedItems, gradeFilter]);

  const sortedItems = useMemo(() => {
    const next = [...filteredItems];

    switch (sortKey) {
      case "value":
        return next.sort((left, right) => right.totalCurrentUsd - left.totalCurrentUsd);
      case "pl":
        return next.sort((left, right) => right.gainLossUsd - left.gainLossUsd);
      case "name":
        return next.sort((left, right) => left.name.localeCompare(right.name));
      default:
        return next.sort((left, right) =>
          recentDirection === "newest"
            ? right.addedAt.localeCompare(left.addedAt)
            : left.addedAt.localeCompare(right.addedAt),
        );
    }
  }, [filteredItems, recentDirection, sortKey]);

  const handleRecentSortClick = () => {
    if (sortKey === "recent") {
      setRecentDirection((current) => (current === "newest" ? "oldest" : "newest"));
      return;
    }

    setSortKey("recent");
    setRecentDirection("newest");
  };

  const updateQuantity = (target: PortfolioItem, nextQuantity: number) => {
    const safeQuantity = Math.max(0, Math.floor(nextQuantity));
    const targetKey = portfolioItemKey(target);

    if (safeQuantity <= 0) {
      writePortfolio(items.filter((item) => portfolioItemKey(item) !== targetKey));
      return;
    }

    writePortfolio(
      items.map((item) =>
        portfolioItemKey(item) === targetKey
          ? {
              ...item,
              quantity: safeQuantity,
            }
          : item,
      ),
    );
    setOpenActionKey(null);
  };

  const updateCostBasis = (target: PortfolioItem, nextCostBasisUsd: number) => {
    const targetKey = portfolioItemKey(target);
    const safeCostBasisUsd =
      Number.isFinite(nextCostBasisUsd) && nextCostBasisUsd > 0
        ? Math.round(nextCostBasisUsd * 100) / 100
        : 0;

    if (isUsableMarketPriceUsd(safeCostBasisUsd)) {
      contributeHoldingMarket(target, safeCostBasisUsd, "paid");
    }

    writePortfolio(
      items.map((item) =>
        portfolioItemKey(item) === targetKey
          ? {
              ...item,
              costBasisUsd: safeCostBasisUsd,
            }
          : item,
      ),
    );
    setOpenActionKey(null);
  };

  const activeItem = openActionKey
    ? sortedItems.find((item) => portfolioItemKey(item) === openActionKey)
    : undefined;

  // Close the edit pop-out with Escape and lock background scroll while it is open.
  useEffect(() => {
    if (!activeItem) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenActionKey(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeItem]);

  useEffect(() => {
    setDrawerNotice("");
  }, [openActionKey]);

  const openCardDetail = (item: (typeof enrichedItems)[number]) => {
    stashPortfolioItemForNavigation(item, item.catalogCard);
    router.push(`/cards/${item.slug}`);
  };

  const removeItem = (target: PortfolioItem) => {
    const targetKey = portfolioItemKey(target);
    writePortfolio(items.filter((item) => portfolioItemKey(item) !== targetKey));
    setOpenActionKey(null);
  };

  const recordSaleAndRemove = (target: PortfolioItem, soldUsd: number) => {
    if (!isUsableMarketPriceUsd(soldUsd)) {
      setDrawerNotice("Enter a sale between $0.25 and $250,000 to record it.");
      return;
    }

    contributeHoldingMarket(target, soldUsd, "sold");
    removeItem(target);
  };

  // Explicit hydration gate: until the client store is live, show the skeleton
  // rather than computing/painting the full dashboard (avoids the render hang
  // and any SSR/CSR mismatch from the localStorage-backed portfolio).
  if (!mounted) {
    return <BinderDashboardSkeleton />;
  }

  const dayDirection = trendDirection(totalDayChangeUsd);
  const plDirection = trendDirection(gainLossUsd, trackedCostUsd > 0);
  const dayMovePercent = portfolioDayMovePercent(totalValueUsd, totalDayChangeUsd);
  const costedCount = enrichedItems.reduce(
    (sum, item) => sum + (item.hasTrackedCost ? item.quantity : 0),
    0,
  );
  const isRanked = RANKED_SORTS.includes(sortKey);
  // The scale reads -100% to +100% with zero at centre, so the bar grows out
  // from the middle in whichever direction the position actually moved.
  const scalePercent = Math.max(-100, Math.min(100, gainLossPercent ?? 0));

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="sheet registry" ref={registryRef} data-print={registryPhase}>
        <header className="sheet-band">
          <h2 className="sheet-band-title">Portfolio</h2>
          <p className="sheet-meta">
            <span>
              {enrichedItems.length} {enrichedItems.length === 1 ? "card" : "cards"}
            </span>
            <span>
              {holdingsCount} {holdingsCount === 1 ? "unit" : "units"}
            </span>
            <CurrencyLabel />
          </p>
        </header>

        <div className="registry-body">
          <div className="registry-lead">
            <p className="registry-label">Total value</p>
            <ClientPrice amountUsd={totalValueUsd} className="registry-figure" />

            <p className="registry-delta" data-dir={dayDirection}>
              {dayDirection === "flat" ? (
                <FlatMark className="trend-glyph" />
              ) : (
                <TrendMark className="trend-glyph" />
              )}
              <ClientPrice amountUsd={Math.abs(totalDayChangeUsd)} />
              <span className="registry-delta-note">
                {totalValueUsd > 0 ? `${formatPercent(dayMovePercent)} today` : "Awaiting quotes"}
              </span>
            </p>

            {gainLossPercent == null ? (
              <p className="registry-scale registry-side-note">
                Add a cost basis to plot return
              </p>
            ) : (
              <div className="registry-scale">
                <div
                  className="registry-scale-track"
                  role="img"
                  aria-label={`Return on cost: ${formatPercent(gainLossPercent)}`}
                >
                  {[0, 25, 50, 75, 100].map((position) => (
                    <span
                      key={position}
                      className="registry-scale-tick"
                      data-major={position === 50}
                      style={{ left: `${position}%` }}
                      aria-hidden="true"
                    />
                  ))}
                  <span
                    className="registry-scale-fill"
                    data-dir={plDirection}
                    style={{
                      left: `${scalePercent >= 0 ? 50 : 50 + scalePercent / 2}%`,
                      width: `${Math.abs(scalePercent) / 2}%`,
                      transformOrigin: scalePercent >= 0 ? "left" : "right",
                    }}
                    aria-hidden="true"
                  />
                </div>
                <div className="registry-scale-marks" aria-hidden="true">
                  <span>−100%</span>
                  <span>0</span>
                  <span>+100%</span>
                </div>
              </div>
            )}
          </div>

          <dl className="registry-side">
            <div style={{ "--row": 0 } as CSSProperties}>
              <dt>Unrealized P/L</dt>
              <dd data-dir={plDirection}>
                <ClientPrice amountUsd={gainLossUsd} />
                <span className="registry-side-pct">
                  {gainLossPercent == null ? "—" : formatPercent(gainLossPercent)}
                </span>
              </dd>
            </div>
            <div style={{ "--row": 1 } as CSSProperties}>
              <dt>Cost basis</dt>
              <dd>
                {trackedCostUsd > 0 ? (
                  <ClientPrice amountUsd={trackedCostUsd} />
                ) : (
                  <span className="registry-side-note">Not recorded</span>
                )}
              </dd>
            </div>
            <div style={{ "--row": 2 } as CSSProperties}>
              <dt>Costed holdings</dt>
              <dd>
                {costedCount}
                <span className="registry-side-pct">of {holdingsCount} cards</span>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        className="sheet ledger"
        ref={ledgerRef}
        data-print={ledgerPhase}
        data-ranked={isRanked}
      >
        <header className="sheet-band">
          <h2 className="sheet-band-title">Holdings ledger</h2>
          <div className="band-tools">
            {enrichedItems.length > 1 ? (
              <div className="band-seg" role="group" aria-label="Sort holdings">
                <button
                  type="button"
                  onClick={handleRecentSortClick}
                  className="band-seg-btn"
                  data-dir={sortKey === "recent" ? recentDirection : "newest"}
                  aria-pressed={sortKey === "recent"}
                  aria-label={
                    sortKey === "recent" && recentDirection === "newest"
                      ? "Sorted newest first. Activate to sort oldest first."
                      : "Sort by most recently added"
                  }
                >
                  <SortMark className="band-seg-icon" />
                  Added
                </button>
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSortKey(option.key)}
                    className="band-seg-btn"
                    aria-pressed={sortKey === option.key}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}

            {enrichedItems.length ? (
              <div className="band-seg" role="group" aria-label="Filter holdings by grade">
                {GRADE_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setGradeFilter(option.key)}
                    className="band-seg-btn"
                    aria-pressed={gradeFilter === option.key}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}

            <Link href="/search" className="band-action">
              <PlusMark />
              Add cards
            </Link>
          </div>
        </header>

        {enrichedItems.length === 0 ? (
          <div className="ledger-empty">
            <div className="ledger-empty-rule" aria-hidden="true" />
            <p className="ledger-empty-title">No cards on the ledger yet</p>
            <p className="ledger-empty-note">
              Add a card from search or its detail page and it starts tracking market
              value straight away. Cost basis is optional — record it whenever you
              want profit and loss.
            </p>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="ledger-empty">
            <div className="ledger-empty-rule" aria-hidden="true" />
            <p className="ledger-empty-title">
              No {gradeFilter} holdings on this ledger
            </p>
            <p className="ledger-empty-note">
              Switch the filter back to All to see every card you track.
            </p>
          </div>
        ) : (
          <>
            {/* Duplicated for screen readers by each cell's own label. */}
            <div className="ledger-head" aria-hidden="true">
              <span />
              <span>Card</span>
              <span>Cost basis</span>
              <span>Market value</span>
              <span>Today</span>
              <span>Total P/L</span>
              <span />
            </div>

            <ol className="ledger-rows">
              {sortedItems.map((item, index) => {
                const key = portfolioItemKey(item);
                const itemDayDirection = trendDirection(item.dayChangeUsd);
                const itemPlDirection = trendDirection(item.gainLossUsd, item.hasTrackedCost);

                return (
                  <li
                    key={`${item.slug}-${item.grade}-${item.addedAt}`}
                    className="ledger-row"
                    style={{ "--row": index } as CSSProperties}
                    data-menu-open={openActionKey === key}
                    onClick={(event) => {
                      // The name is a real link and the menu a real button;
                      // the rest of the row is a convenience target.
                      if ((event.target as HTMLElement).closest("a, button")) {
                        return;
                      }
                      openCardDetail(item);
                    }}
                  >
                    <div className="ledger-mark">
                      {isRanked ? (
                        <span className="ledger-rank">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      ) : null}
                      <HoloTilt className="ledger-thumb" max={10}>
                        <Image
                          src={item.image}
                          alt=""
                          fill
                          sizes="64px"
                          unoptimized
                          className="object-contain"
                        />
                      </HoloTilt>
                    </div>

                    <div className="ledger-identity">
                      <p className="ledger-name">
                        <Link
                          href={`/cards/${item.slug}`}
                          className="ledger-name-link"
                          onClick={() =>
                            stashPortfolioItemForNavigation(item, item.catalogCard)
                          }
                        >
                          {item.name}
                        </Link>
                        <span
                          className="slab-tab"
                          data-graded={item.grade !== "Ungraded"}
                        >
                          {item.grade === "Ungraded" ? "Raw" : item.grade}
                        </span>
                      </p>
                      <p className="ledger-meta">
                        <span>{item.setName}</span>
                        {item.setCode ? <span className="mono">{item.setCode}</span> : null}
                        <span className="mono">#{item.collectorNumber}</span>
                        <span>{item.rarity}</span>
                        <span className="mono">×{item.quantity}</span>
                      </p>
                    </div>

                    <div className="ledger-figures">
                      <div className="ledger-cell">
                        <span className="ledger-cell-label">Cost basis</span>
                        {item.hasTrackedCost ? (
                          <>
                            <span className="ledger-num">
                              <ClientPrice amountUsd={item.totalCostUsd} />
                            </span>
                            {/* The unit price only says something new
                                once there is more than one copy. */}
                            {item.quantity > 1 ? (
                              <span className="ledger-sub">
                                <ClientPrice amountUsd={item.costBasisUsd} /> each
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span className="ledger-num" data-muted="true">
                              Not set
                            </span>
                            <span className="ledger-sub">Optional</span>
                          </>
                        )}
                      </div>

                      <div className="ledger-cell">
                        <span className="ledger-cell-label">Market value</span>
                        {item.isMarketPending ? (
                          <>
                            <span className="ledger-num" data-muted="true">
                              Updating
                            </span>
                            <span className="ledger-sub">Fetching quote</span>
                          </>
                        ) : item.currentValueUsd > 0 ? (
                          <>
                            <span className="ledger-num">
                              <ClientPrice amountUsd={item.totalCurrentUsd} />
                            </span>
                            {item.quantity > 1 ? (
                              <span className="ledger-sub">
                                <ClientPrice amountUsd={item.currentValueUsd} /> each
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span className="ledger-num" data-muted="true">
                              Pending
                            </span>
                            <span className="ledger-sub">No quote yet</span>
                          </>
                        )}
                      </div>

                      <div className="ledger-cell">
                        <span className="ledger-cell-label">Today</span>
                        <span className="ledger-num" data-dir={itemDayDirection}>
                          <ClientPrice amountUsd={item.dayChangeUsd * item.quantity} />
                        </span>
                        <span className="ledger-sub" data-dir={itemDayDirection}>
                          {formatPercent(item.dayChangePercent)}
                        </span>
                      </div>

                      <div className="ledger-cell">
                        <span className="ledger-cell-label">Total P/L</span>
                        {item.hasTrackedCost ? (
                          <>
                            <span className="ledger-num" data-dir={itemPlDirection}>
                              <ClientPrice amountUsd={item.gainLossUsd} />
                            </span>
                            <span className="ledger-sub" data-dir={itemPlDirection}>
                              {item.gainLossPercent == null
                                ? "0.0%"
                                : formatPercent(item.gainLossPercent)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="ledger-num" data-muted="true">
                              —
                            </span>
                            <span className="ledger-sub">Add cost basis</span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setOpenActionKey((current) => (current === key ? null : key))
                      }
                      className="ledger-menu"
                      aria-haspopup="dialog"
                      aria-expanded={openActionKey === key}
                      aria-label={`Edit ${item.name}`}
                    >
                      <span />
                      <span />
                      <span />
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      {enrichedItems.length > 0 ? (
        <BinderInsights
          items={analyticsItems}
          totalValueUsd={totalValueUsd}
          history={portfolioHistory}
        />
      ) : null}

      {mounted && activeItem
        ? createPortal(
            <div
              className="binder-drawer-backdrop"
              onClick={() => setOpenActionKey(null)}
            >
              <section
                className="binder-drawer"
                role="dialog"
                aria-modal="true"
                aria-label={`Edit ${activeItem.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <header className="binder-drawer-header">
                  <div className="binder-drawer-card">
                    <span className="binder-drawer-thumb">
                      <Image
                        src={activeItem.image}
                        alt={activeItem.name}
                        fill
                        sizes="48px"
                        unoptimized
                        className="object-contain"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="binder-drawer-card-name">{activeItem.name}</span>
                      <span className="binder-drawer-card-meta">
                        <span className="premium-badge">{activeItem.grade}</span>
                        <span className="binder-mini-chip">Qty {activeItem.quantity}</span>
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="binder-drawer-close"
                    onClick={() => setOpenActionKey(null)}
                    aria-label="Close editor"
                  >
                    ×
                  </button>
                </header>

                <div className="binder-drawer-body">
                  <div className="binder-drawer-field">
                    <p>Adjust holding</p>
                    <div className="binder-qty-control">
                      <button
                        type="button"
                        onClick={() => updateQuantity(activeItem, activeItem.quantity - 1)}
                        aria-label={`Decrease ${activeItem.name} quantity`}
                      >
                        −
                      </button>
                      <span>{activeItem.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(activeItem, activeItem.quantity + 1)}
                        aria-label={`Increase ${activeItem.name} quantity`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <form
                    className="binder-cost-editor binder-drawer-field"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const formData = new FormData(event.currentTarget);
                      const rawCost = Number.parseFloat(String(formData.get("costBasis") ?? ""));
                      updateCostBasis(activeItem, rawCost);
                    }}
                  >
                    <label htmlFor={`cost-${portfolioItemKey(activeItem).replace(/[^A-Za-z0-9_-]/g, "-")}`}>
                      Unit cost
                    </label>
                    <div className="binder-cost-row">
                      <span>$</span>
                      <input
                        id={`cost-${portfolioItemKey(activeItem).replace(/[^A-Za-z0-9_-]/g, "-")}`}
                        name="costBasis"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        defaultValue={activeItem.hasTrackedCost ? activeItem.costBasisUsd.toFixed(2) : ""}
                      />
                    </div>
                    <div className="binder-cost-actions">
                      <button type="submit" className="btn btn-primary btn-sm">
                        Save cost
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => updateCostBasis(activeItem, 0)}
                      >
                        Clear
                      </button>
                    </div>
                  </form>
                  <form
                    className="binder-cost-editor binder-drawer-field"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const formData = new FormData(event.currentTarget);
                      const rawSold = Number.parseFloat(String(formData.get("soldUsd") ?? ""));
                      recordSaleAndRemove(activeItem, rawSold);
                    }}
                  >
                    <label htmlFor={`sold-${portfolioItemKey(activeItem).replace(/[^A-Za-z0-9_-]/g, "-")}`}>
                      Record sale
                    </label>
                    <p className="text-[11px] leading-4 text-slate-400">
                      Adds a first-party sold comp, then removes this holding. Delete without a
                      sale does not report a price.
                    </p>
                    <div className="binder-cost-row">
                      <span>$</span>
                      <input
                        id={`sold-${portfolioItemKey(activeItem).replace(/[^A-Za-z0-9_-]/g, "-")}`}
                        name="soldUsd"
                        type="number"
                        inputMode="decimal"
                        min="0.25"
                        step="0.01"
                        placeholder="Sold for"
                      />
                    </div>
                    <div className="binder-cost-actions">
                      <button type="submit" className="btn btn-primary btn-sm">
                        Sold &amp; remove
                      </button>
                    </div>
                  </form>
                  {drawerNotice ? (
                    <p className="text-sm font-semibold text-amber-200">{drawerNotice}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeItem(activeItem)}
                    className="btn btn-destructive btn-sm binder-remove-button"
                  >
                    Delete card
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
