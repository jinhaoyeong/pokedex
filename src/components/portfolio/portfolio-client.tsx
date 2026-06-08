"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { ClientPrice } from "@/components/client-price";
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

function positivePrice(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getHistoryValue(
  point: { value: number; gradeValues?: Record<string, number> },
  grade: string,
) {
  if (grade === "Ungraded") {
    return positivePrice(point.gradeValues?.Ungraded) ?? positivePrice(point.value);
  }

  return positivePrice(point.gradeValues?.[grade]);
}

export function PortfolioClient() {
  const router = useRouter();
  const [openActionKey, setOpenActionKey] = useState<string | null>(null);
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

    Promise.allSettled(
      items.map(async (item) => {
        const key = portfolioItemKey(item);
        const localCard = cards.find((card) => card.id === item.cardId || card.slug === item.slug);
        const localMarketValue =
          positivePrice(item.marketValueUsd) ??
          positivePrice(localCard?.gradedPrices.find((price) => price.grade === item.grade)?.value) ??
          positivePrice(localCard?.marketPriceUsd);
        const params = new URLSearchParams({
          setName: item.setName,
          cardName: item.name,
          cardNumber: item.collectorNumber,
        });

        if (typeof localMarketValue === "number") {
          params.set("rawMarketPriceUsd", localMarketValue.toString());
        }
        const localSetTotal = localCard?.setPrintedTotal ?? localCard?.setTotal;
        if (typeof localSetTotal === "number" && localSetTotal > 0) {
          params.set("setTotal", localSetTotal.toString());
        }
        const rarity = item.rarity ?? localCard?.rarity;
        if (rarity && rarity !== "Unknown") {
          params.set("rarity", rarity);
        }

        const response = await fetch(`/api/grading-market?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          return null;
        }

        const data = (await response.json()) as {
          gradedPrices?: GradedPrice[];
          priceConsensus?: PriceConsensus;
        };
        const gradeValue =
          positivePrice(data.gradedPrices?.find((price) => price.grade === item.grade)?.value) ??
          (item.grade === "Ungraded"
            ? positivePrice(data.priceConsensus?.finalEstimateUsd)
            : undefined);

        if (typeof gradeValue !== "number") {
          return null;
        }

        return {
          key,
          value: gradeValue,
          source:
            data.gradedPrices?.find((price) => price.grade === item.grade)?.source ??
            data.priceConsensus?.methodology,
        };
      }),
    ).then((results) => {
      if (controller.signal.aborted) {
        return;
      }

      const nextOverrides: Record<string, { value: number; source?: string; fetchedAt: string }> = {};

      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value) {
          continue;
        }

        nextOverrides[result.value.key] = {
          value: result.value.value,
          source: result.value.source,
          fetchedAt: new Date().toISOString(),
        };
      }

      if (Object.keys(nextOverrides).length) {
        setMarketOverrides((current) => ({ ...current, ...nextOverrides }));
      }
    });

    return () => controller.abort();
  }, [items]);

  const enrichedItems = useMemo(() => {
    const cards = getCards();

    return items.map((item) => {
      const liveCard = cards.find((card) => card.id === item.cardId || card.slug === item.slug);
      const overrideMarketValue = positivePrice(marketOverrides[portfolioItemKey(item)]?.value);
      const capturedMarketValue = positivePrice(item.marketValueUsd);
      const catalogMarketValue =
        positivePrice(liveCard?.gradedPrices.find((price) => price.grade === item.grade)?.value) ??
        positivePrice(liveCard?.marketPriceUsd);
      const currentValueUsd =
        overrideMarketValue ?? capturedMarketValue ?? catalogMarketValue ?? item.costBasisUsd;
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
      const gainLossPercent = totalCostUsd > 0 ? (gainLossUsd / totalCostUsd) * 100 : 0;

      return {
        ...item,
        currentValueUsd,
        dayChangePercent,
        dayChangeUsd,
        gainLossPercent,
        gainLossUsd,
        rarity: item.rarity ?? liveCard?.rarity ?? "Tracked card",
        setCode: item.setCode ?? liveCard?.setCode ?? "",
        marketSource:
          marketOverrides[portfolioItemKey(item)]?.source ??
          item.marketSource ??
          (catalogMarketValue ? "Local catalog market" : "Cost fallback"),
        totalCostUsd,
        totalCurrentUsd,
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

  const gainLossUsd = totalValueUsd - totalCostUsd;
  const gainLossPercent = totalCostUsd > 0 ? (gainLossUsd / totalCostUsd) * 100 : 0;

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
                {gainLossPercent.toFixed(1)}%
              </strong>
            </div>
          </div>
          <div className="binder-meter mt-5">
            <span style={{ width: `${Math.min(Math.max(gainLossPercent + 50, 8), 100)}%` }} />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
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
            <p className="text-xs font-black uppercase tracking-[0.2em] text-red-200 sm:text-sm sm:tracking-[0.24em]">
              Unrealized P/L
            </p>
            <ClientPrice
              amountUsd={gainLossUsd}
              className={`mt-2 block text-2xl font-semibold sm:mt-3 sm:text-3xl ${
                gainLossUsd >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            />
          </div>
        </div>
      </section>

      <section className="binder-vault-panel relative overflow-hidden rounded-3xl p-5 sm:p-7">
        <div className="binder-vault-shine" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
              Binder vault
            </p>
            <h2 className="mt-2 text-2xl font-black text-white">Holdings ledger</h2>
          </div>
          <Link
            href="/search"
            className="trainer-button inline-flex w-full items-center justify-center rounded-full bg-blue-500 px-4 py-2 text-sm font-black text-white sm:w-auto"
          >
            Add more cards
          </Link>
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
            {enrichedItems.map((item) => (
              <article
                key={`${item.slug}-${item.grade}-${item.addedAt}`}
                className="binder-item-card"
                role="link"
                tabIndex={0}
                aria-label={`View details for ${item.name}`}
                onClick={() => router.push(`/cards/${item.slug}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`/cards/${item.slug}`);
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
                    <ClientPrice amountUsd={item.totalCostUsd} className="mt-1 block font-black text-white" />
                    <span>Unit cost</span>
                    <ClientPrice amountUsd={item.costBasisUsd} className="text-xs text-slate-400" />
                  </div>
                  <div className="binder-value-cell">
                    <p>Current value</p>
                    <ClientPrice amountUsd={item.totalCurrentUsd} className="mt-1 block font-black text-white" />
                    <span>Unit market</span>
                    <ClientPrice amountUsd={item.currentValueUsd} className="text-xs text-slate-400" />
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
                      {formatPercent(item.gainLossPercent)}
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
