"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { ClientPrice } from "@/components/client-price";
import { BinderInsights } from "@/components/portfolio/binder-insights";
import {
  type BinderAnalyticsItem,
  aggregatePortfolioHistory,
  getHistoryValue,
} from "@/lib/binder-analytics";
import {
  buildBinderMarketSearchParams,
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

function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

type BinderSortKey = "recent" | "value" | "today" | "pl" | "name";

const SORT_OPTIONS: Array<{ key: BinderSortKey; label: string }> = [
  { key: "recent", label: "Recent" },
  { key: "value", label: "Value" },
  { key: "today", label: "Today" },
  { key: "pl", label: "P/L" },
  { key: "name", label: "A–Z" },
];

export function PortfolioClient() {
  const router = useRouter();
  const [openActionKey, setOpenActionKey] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<BinderSortKey>("recent");
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

    Promise.allSettled(
      items.map(async (item) => {
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

        const response = await fetch(
          `/api/grading-market?${buildBinderMarketSearchParams(item, localCard).toString()}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          return null;
        }

        const data = (await response.json()) as {
          gradedPrices?: GradedPrice[];
          priceConsensus?: PriceConsensus;
        };
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
      }),
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
        writePortfolio(
          items.map((item) => {
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

            return {
              ...item,
              marketValueUsd: fetched.value,
              marketValueUpdatedAt: fetchedAt,
              marketSource: fetched.source ?? item.marketSource,
            };
          }),
        );
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
      const totalCostUsd = item.costBasisUsd * item.quantity;
      const totalCurrentUsd = currentValueUsd * item.quantity;
      const gainLossUsd = totalCurrentUsd - totalCostUsd;
      const gainLossPercent = hasTrackedCost(item.costBasisUsd)
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
        hasTrackedCost: hasTrackedCost(item.costBasisUsd),
      };
    });
  }, [items, marketOverrides]);

  const totalValueUsd = enrichedItems.reduce(
    (sum, item) => sum + item.currentValueUsd * item.quantity,
    0,
  );

  const totalCostUsd = enrichedItems.reduce(
    (sum, item) => sum + item.costBasisUsd * item.quantity,
    0,
  );

  const trackedCostUsd = enrichedItems.reduce(
    (sum, item) => sum + (item.hasTrackedCost ? item.costBasisUsd * item.quantity : 0),
    0,
  );

  const gainLossUsd = totalValueUsd - trackedCostUsd;
  const gainLossPercent =
    trackedCostUsd > 0 ? (gainLossUsd / trackedCostUsd) * 100 : null;

  const totalDayChangeUsd = enrichedItems.reduce(
    (sum, item) => sum + item.dayChangeUsd * item.quantity,
    0,
  );

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
      })),
    [enrichedItems],
  );

  const portfolioHistory = useMemo(
    () => aggregatePortfolioHistory(analyticsItems),
    [analyticsItems],
  );

  const sortedItems = useMemo(() => {
    const next = [...enrichedItems];

    switch (sortKey) {
      case "value":
        return next.sort((left, right) => right.totalCurrentUsd - left.totalCurrentUsd);
      case "today":
        return next.sort(
          (left, right) =>
            right.dayChangeUsd * right.quantity - left.dayChangeUsd * left.quantity,
        );
      case "pl":
        return next.sort((left, right) => right.gainLossUsd - left.gainLossUsd);
      case "name":
        return next.sort((left, right) => left.name.localeCompare(right.name));
      default:
        return next.sort((left, right) => right.addedAt.localeCompare(left.addedAt));
    }
  }, [enrichedItems, sortKey]);

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

  const openCardDetail = (item: (typeof enrichedItems)[number]) => {
    stashPortfolioItemForNavigation(item, item.catalogCard);
    router.push(`/cards/${item.slug}`);
  };

  const removeItem = (target: PortfolioItem) => {
    const targetKey = portfolioItemKey(target);
    writePortfolio(items.filter((item) => portfolioItemKey(item) !== targetKey));
    setOpenActionKey(null);
  };

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="binder-dashboard grid gap-5 lg:grid-cols-[0.95fr_1.25fr]">
        <div className="binder-scorecard">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
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
          <div className="binder-stat-card">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-200 sm:text-sm sm:tracking-[0.24em]">
              Total Value
            </p>
            <ClientPrice
              amountUsd={totalValueUsd}
              className="mt-2 block text-2xl font-semibold text-white sm:mt-3 sm:text-3xl"
            />
          </div>
          <div className="binder-stat-card">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-200 sm:text-sm sm:tracking-[0.24em]">
              Today
            </p>
            <ClientPrice
              amountUsd={totalDayChangeUsd}
              className={`mt-2 block text-2xl font-semibold sm:mt-3 sm:text-3xl ${
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
          <div className="binder-stat-card">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-red-200 sm:text-sm sm:tracking-[0.24em]">
              Unrealized P/L
            </p>
            <ClientPrice
              amountUsd={gainLossUsd}
              className={`mt-2 block text-2xl font-semibold sm:mt-3 sm:text-3xl ${
                gainLossUsd >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            />
            {trackedCostUsd <= 0 && totalValueUsd > 0 ? (
              <p className="mt-2 text-xs text-slate-400">Based on live market value</p>
            ) : null}
          </div>
        </div>
      </section>

      {enrichedItems.length > 0 ? (
        <BinderInsights
          items={analyticsItems}
          totalValueUsd={totalValueUsd}
          history={portfolioHistory}
        />
      ) : null}

      <section className="binder-vault-panel relative overflow-hidden rounded-3xl p-5 sm:p-7">
        <div className="binder-vault-shine" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
              Binder vault
            </p>
            <h2 className="mt-2 text-2xl font-black text-white">Holdings ledger</h2>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {enrichedItems.length > 1 ? (
              <div className="binder-sort" role="group" aria-label="Sort holdings">
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
            <Link
              href="/search"
              className="trainer-button inline-flex w-full items-center justify-center rounded-full bg-blue-500 px-4 py-2 text-sm font-black text-white sm:w-auto"
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
        ) : (
          <div className="relative z-10 mt-6 grid gap-4">
            {sortedItems.map((item) => (
              <article
                key={`${item.slug}-${item.grade}-${item.addedAt}`}
                className="binder-item-card"
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
                    className="object-contain"
                  />
                </div>
                <div className="binder-item-identity min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-white">
                      {item.name}
                    </span>
                    <span className="rounded-full border border-yellow-200/25 bg-yellow-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-yellow-100">
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
                    aria-expanded={openActionKey === portfolioItemKey(item)}
                    aria-label={`Open actions for ${item.name}`}
                  >
                    <span />
                    <span />
                    <span />
                  </button>
                  {openActionKey === portfolioItemKey(item) ? (
                    <div className="binder-action-menu" onClick={(event) => event.stopPropagation()}>
                      <p>Adjust holding</p>
                      <div className="binder-qty-control">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            updateQuantity(item, item.quantity - 1);
                          }}
                          aria-label={`Decrease ${item.name} quantity`}
                        >
                          -
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            updateQuantity(item, item.quantity + 1);
                          }}
                          aria-label={`Increase ${item.name} quantity`}
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeItem(item);
                        }}
                        className="binder-remove-button"
                      >
                        Delete card
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
