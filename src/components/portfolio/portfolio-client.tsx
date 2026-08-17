"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { ClientPrice } from "@/components/client-price";
import { BinderInsights } from "@/components/portfolio/binder-insights";
import {
  type BinderAnalyticsItem,
  aggregatePortfolioHistory,
  getHistoryValue,
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
      <section className="binder-dashboard grid gap-5 lg:grid-cols-[0.95fr_1.25fr]">
        <div className="glass-card h-44 animate-pulse rounded-2xl" />
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="glass-card h-44 animate-pulse rounded-2xl" />
          <div className="glass-card h-44 animate-pulse rounded-2xl" />
          <div className="glass-card h-44 animate-pulse rounded-2xl" />
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="glass-card h-28 animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export function PortfolioClient() {
  const router = useRouter();
  const [openActionKey, setOpenActionKey] = useState<string | null>(null);
  const mounted = useSyncExternalStore(subscribeMounted, getMounted, getServerMounted);
  const [sortKey, setSortKey] = useState<BinderSortKey>("recent");
  const [recentDirection, setRecentDirection] = useState<BinderRecentDirection>("newest");
  const [gradeFilter, setGradeFilter] = useState<BinderGradeFilter>("all");

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
      const dayChangeUsd =
        typeof lastHistoryValue === "number" && typeof previousHistoryValue === "number"
          ? lastHistoryValue - previousHistoryValue
          : 0;
      const dayChangePercent =
        typeof previousHistoryValue === "number" && previousHistoryValue > 0
          ? (dayChangeUsd / previousHistoryValue) * 100
          : 0;
      const itemHasTrackedCost = hasTrackedCost(item.costBasisUsd);
      const totalCostUsd = item.costBasisUsd * item.quantity;
      const totalCurrentUsd = currentValueUsd * item.quantity;
      const gainLossUsd = itemHasTrackedCost ? totalCurrentUsd - totalCostUsd : 0;
      const gainLossPercent = itemHasTrackedCost && totalCostUsd > 0
        ? (gainLossUsd / totalCostUsd) * 100
        : null;
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

    const gainLoss = trackedCurrent - trackedCost;

    return {
      totalValueUsd: totalValue,
      trackedCostUsd: trackedCost,
      trackedCurrentValueUsd: trackedCurrent,
      gainLossUsd: gainLoss,
      gainLossPercent: trackedCost > 0 ? (gainLoss / trackedCost) * 100 : null,
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

  const openCardDetail = (item: (typeof enrichedItems)[number]) => {
    stashPortfolioItemForNavigation(item, item.catalogCard);
    router.push(`/cards/${item.slug}`);
  };

  const removeItem = (target: PortfolioItem) => {
    const targetKey = portfolioItemKey(target);
    writePortfolio(items.filter((item) => portfolioItemKey(item) !== targetKey));
    setOpenActionKey(null);
  };

  // Explicit hydration gate: until the client store is live, show the skeleton
  // rather than computing/painting the full dashboard (avoids the render hang
  // and any SSR/CSR mismatch from the localStorage-backed portfolio).
  if (!mounted) {
    return <BinderDashboardSkeleton />;
  }

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="binder-dashboard grid gap-5 lg:grid-cols-[0.95fr_1.25fr]">
        <div className="binder-scorecard">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--text-faint)]">
            Collection grade
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <span>Holdings</span>
              <strong>{enrichedItems.length}</strong>
            </div>
            <div>
              <span>P/L</span>
              <strong className={gainLossUsd >= 0 ? "text-emerald-200" : "text-rose-200"}>
                {gainLossPercent == null ? "—" : `${gainLossPercent.toFixed(1)}%`}
              </strong>
            </div>
          </div>
          <div className="binder-meter mt-5">
            <span
              style={{
                width: `${Math.min(Math.max((gainLossPercent ?? 0) + 50, 8), 100)}%`,
              }}
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <div className="binder-stat-card" data-trend="flat">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)] sm:text-sm sm:tracking-[0.24em]">
              Total Value
            </p>
            <ClientPrice
              amountUsd={totalValueUsd}
              className="stat-figure mt-2 block text-2xl font-semibold text-white sm:mt-3 sm:text-3xl"
            />
          </div>
          <div className="binder-stat-card" data-trend={totalDayChangeUsd >= 0 ? "up" : "down"}>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)] sm:text-sm sm:tracking-[0.24em]">
              Today
            </p>
            <ClientPrice
              amountUsd={totalDayChangeUsd}
              className={`stat-figure mt-2 block text-2xl font-semibold sm:mt-3 sm:text-3xl ${
                totalDayChangeUsd >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            />
            <p className="mt-2 text-xs text-slate-400">
              {totalValueUsd > 0
                ? `${totalDayChangeUsd >= 0 ? "+" : ""}${(
                    (totalDayChangeUsd / Math.max(totalValueUsd - totalDayChangeUsd, 1)) *
                    100
                  ).toFixed(2)}% day move`
                : "Live market move"}
            </p>
          </div>
          <div className="binder-stat-card" data-trend={gainLossUsd >= 0 ? "up" : "down"}>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)] sm:text-sm sm:tracking-[0.24em]">
              Unrealized P/L
            </p>
            <ClientPrice
              amountUsd={gainLossUsd}
              className={`stat-figure mt-2 block text-2xl font-semibold sm:mt-3 sm:text-3xl ${
                gainLossUsd >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            />
            {trackedCostUsd <= 0 && totalValueUsd > 0 ? (
              <p className="mt-2 text-xs text-slate-400">Add cost basis to unlock P/L</p>
            ) : trackedCostUsd > 0 && trackedCurrentValueUsd < totalValueUsd ? (
              <p className="mt-2 text-xs text-slate-400">Costed holdings only</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="binder-vault-panel relative overflow-visible rounded-3xl p-5 sm:p-7">
        <div className="binder-vault-shine" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--text-faint)]">
              Binder vault
            </p>
            <h2 className="mt-2 text-2xl font-black text-white">Holdings ledger</h2>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {enrichedItems.length > 1 ? (
              <div className="binder-sort" role="group" aria-label="Sort holdings">
                <button
                  type="button"
                  onClick={handleRecentSortClick}
                  className={sortKey === "recent" ? "is-active" : undefined}
                  aria-pressed={sortKey === "recent"}
                  aria-label={
                    recentDirection === "newest"
                      ? "Sort holdings by oldest to newest"
                      : "Sort holdings by most recent"
                  }
                >
                  <span>
                    {sortKey === "recent" && recentDirection === "oldest"
                      ? "Oldest to newest"
                      : "Most recent"}
                  </span>
                  <span className="binder-sort-arrow" aria-hidden="true">
                    {sortKey === "recent" && recentDirection === "oldest" ? "↑" : "↓"}
                  </span>
                </button>
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSortKey(option.key)}
                    className={sortKey === option.key ? "is-active" : undefined}
                    aria-pressed={sortKey === option.key}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            {enrichedItems.length ? (
              <div className="binder-sort" role="group" aria-label="Filter holdings by grade">
                {GRADE_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setGradeFilter(option.key)}
                    className={gradeFilter === option.key ? "is-active" : undefined}
                    aria-pressed={gradeFilter === option.key}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <Link
              href="/search"
              className="btn btn-primary btn-sm w-full sm:w-auto"
            >
              Add more cards
            </Link>
          </div>
        </div>

        {enrichedItems.length === 0 ? (
          <div className="binder-empty-state mt-5 rounded-3xl p-6 text-center sm:mt-6 sm:p-8">
            <div className="pokeball-mark mx-auto" />
            <p className="mt-4 text-lg font-black text-white">No cards added yet.</p>
            <p className="mt-2 text-sm text-slate-400">
              Add cards from the detail page to start tracking your collection.
            </p>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="binder-empty-state mt-5 rounded-3xl p-6 text-center sm:mt-6 sm:p-8">
            <p className="text-lg font-black text-white">No holdings match this filter.</p>
            <p className="mt-2 text-sm text-slate-400">
              Switch back to All to see every card in your binder.
            </p>
          </div>
        ) : (
          <div className="binder-vault-grid relative z-10 mt-6 grid gap-4">
            {sortedItems.map((item) => (
              <article
                key={`${item.slug}-${item.grade}-${item.addedAt}`}
                className={`binder-item-card ${
                  openActionKey === portfolioItemKey(item) ? "is-menu-open" : ""
                }`}
                role="link"
                tabIndex={0}
                aria-label={`View details for ${item.name}`}
                onClick={() => openCardDetail(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openCardDetail(item);
                  }
                }}
              >
                <div className="binder-item-image">
                  <Image
                    src={item.image}
                    alt={item.name}
                    fill
                    sizes="88px"
                    unoptimized
                    className="object-contain"
                  />
                </div>
                <div className="binder-item-identity min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-white">
                      {item.name}
                    </span>
                    <span className="premium-badge">
                      {item.grade}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {item.setName} {item.setCode ? `(${item.setCode})` : ""} / #
                    {item.collectorNumber}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300">
                    <span className="binder-mini-chip">{item.rarity}</span>
                    <span className="binder-mini-chip">Qty {item.quantity}</span>
                  </div>
                </div>
                <div className="binder-value-grid">
                  <div className="binder-value-cell">
                    <p>Cost basis</p>
                    {item.hasTrackedCost ? (
                      <>
                        <ClientPrice
                          amountUsd={item.totalCostUsd}
                          className="mt-1 block font-black text-white"
                        />
                        <span>Unit cost</span>
                        <ClientPrice
                          amountUsd={item.costBasisUsd}
                          className="text-xs text-slate-400"
                        />
                      </>
                    ) : (
                      <>
                        <span className="mt-1 block font-black text-slate-300">Not set</span>
                        <span>Optional</span>
                        <span className="text-xs text-slate-500">Add cost anytime</span>
                      </>
                    )}
                  </div>
                  <div className="binder-value-cell">
                    <p>Current value</p>
                    {item.isMarketPending ? (
                      <>
                        <span className="mt-1 block font-black text-slate-300">Updating…</span>
                        <span>Unit market</span>
                        <span className="text-xs text-slate-500">Fetching live price</span>
                      </>
                    ) : item.currentValueUsd > 0 ? (
                      <>
                        <ClientPrice
                          amountUsd={item.totalCurrentUsd}
                          className="mt-1 block font-black text-white"
                        />
                        <span>Unit market</span>
                        <ClientPrice
                          amountUsd={item.currentValueUsd}
                          className="text-xs text-slate-400"
                        />
                      </>
                    ) : (
                      <>
                        <span className="mt-1 block font-black text-slate-300">Pending</span>
                        <span>Unit market</span>
                        <span className="text-xs text-slate-500">No live quote yet</span>
                      </>
                    )}
                  </div>
                  <div className="binder-value-cell">
                    <p>Today</p>
                    <ClientPrice
                      amountUsd={item.dayChangeUsd * item.quantity}
                      className={`mt-1 block font-black ${
                        item.dayChangeUsd >= 0 ? "text-emerald-300" : "text-rose-300"
                      }`}
                    />
                    <span className={item.dayChangeUsd >= 0 ? "text-emerald-200" : "text-rose-200"}>
                      {formatPercent(item.dayChangePercent)}
                    </span>
                  </div>
                  <div className="binder-value-cell">
                    <p>Total P/L</p>
                    {item.hasTrackedCost ? (
                      <>
                    <ClientPrice
                      amountUsd={item.gainLossUsd}
                      className={`mt-1 block font-black ${
                        item.gainLossUsd >= 0 ? "text-emerald-300" : "text-rose-300"
                      }`}
                    />
                    <span className={item.gainLossUsd >= 0 ? "text-emerald-200" : "text-rose-200"}>
                      {item.gainLossPercent == null
                        ? item.hasTrackedCost
                          ? "0.0%"
                          : "—"
                        : formatPercent(item.gainLossPercent)}
                    </span>
                      </>
                    ) : (
                      <>
                        <span className="mt-1 block font-black text-slate-300">Not set</span>
                        <span className="text-slate-500">Add cost basis</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="binder-actions">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenActionKey((current) =>
                        current === portfolioItemKey(item) ? null : portfolioItemKey(item),
                      );
                    }}
                    className="binder-menu-button"
                    aria-haspopup="dialog"
                    aria-expanded={openActionKey === portfolioItemKey(item)}
                    aria-label={`Open actions for ${item.name}`}
                  >
                    <span />
                    <span />
                    <span />
                  </button>
                </div>
              </article>
            ))}
          </div>
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
