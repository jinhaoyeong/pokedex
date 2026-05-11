"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

import { ClientPrice } from "@/components/client-price";
import { getCards } from "@/lib/cards";
import { readPortfolio, subscribeToPortfolio } from "@/lib/portfolio-store";
import type { PortfolioItem } from "@/types/pokemon";

const EMPTY_PORTFOLIO_ITEMS: PortfolioItem[] = [];

export function PortfolioClient() {
  const items = useSyncExternalStore(
    subscribeToPortfolio,
    readPortfolio,
    () => EMPTY_PORTFOLIO_ITEMS,
  );

  const enrichedItems = useMemo(() => {
    const cards = getCards();

    return items.map((item) => {
      const liveCard = cards.find((card) => card.id === item.cardId);
      const currentValueUsd =
        liveCard?.gradedPrices.find((price) => price.grade === item.grade)?.value ??
        liveCard?.marketPriceUsd ??
        item.costBasisUsd;

      return {
        ...item,
        currentValueUsd,
      };
    });
  }, [items]);

  const totalValueUsd = enrichedItems.reduce(
    (sum, item) => sum + item.currentValueUsd * item.quantity,
    0,
  );

  const totalCostUsd = enrichedItems.reduce(
    (sum, item) => sum + item.costBasisUsd * item.quantity,
    0,
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="grid gap-3 sm:gap-4 md:grid-cols-3">
        <div className="glass-card card-float rounded-3xl border-yellow-200/20 p-4 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-200 sm:text-sm sm:tracking-[0.24em]">
            Holdings
          </p>
          <p className="mt-2 text-2xl font-semibold text-white sm:mt-3 sm:text-3xl">{enrichedItems.length}</p>
        </div>
        <div className="glass-card rounded-3xl border-blue-300/20 p-4 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-200 sm:text-sm sm:tracking-[0.24em]">
            Total Value
          </p>
          <ClientPrice amountUsd={totalValueUsd} className="mt-2 block text-2xl font-semibold text-white sm:mt-3 sm:text-3xl" />
        </div>
        <div className="glass-card rounded-3xl border-red-300/20 p-4 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-red-200 sm:text-sm sm:tracking-[0.24em]">
            Unrealized P/L
          </p>
          <ClientPrice
            amountUsd={totalValueUsd - totalCostUsd}
            className={`mt-2 block text-2xl font-semibold sm:mt-3 sm:text-3xl ${
              totalValueUsd >= totalCostUsd ? "text-emerald-300" : "text-rose-300"
            }`}
          />
        </div>
      </section>

      <section className="glass-card relative overflow-hidden rounded-3xl p-4 sm:p-6">
        <div className="absolute -right-12 -top-14 h-24 w-24 rounded-full border-[12px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:-right-10 sm:-top-12 sm:h-28 sm:w-28 sm:border-[14px] sm:opacity-40" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
              Binder vault
            </p>
            <h2 className="mt-2 text-2xl font-black text-white">Portfolio items</h2>
          </div>
          <Link
            href="/search"
            className="trainer-button inline-flex w-full items-center justify-center rounded-full bg-blue-500 px-4 py-2 text-sm font-black text-white sm:w-auto"
          >
            Add more cards
          </Link>
        </div>

        {enrichedItems.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-yellow-200/25 bg-yellow-300/5 p-6 text-center sm:mt-6 sm:p-8">
            <div className="pokeball-mark mx-auto" />
            <p className="mt-4 text-lg font-black text-white">No cards added yet.</p>
            <p className="mt-2 text-sm text-slate-400">
              Add cards from the detail page to start tracking your collection.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {enrichedItems.map((item) => (
              <article
                key={`${item.slug}-${item.grade}-${item.addedAt}`}
                className="rounded-3xl border border-yellow-200/15 bg-gradient-to-br from-white/8 to-blue-500/5 p-4 transition hover:-translate-y-0.5 hover:border-yellow-200/35 sm:p-5"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <Link
                      href={`/cards/${item.slug}`}
                      className="text-lg font-semibold text-white hover:text-blue-300"
                    >
                      {item.name}
                    </Link>
                    <p className="mt-1 text-sm text-slate-400">
                      {item.setName} #{item.collectorNumber} · {item.grade}
                    </p>
                  </div>
                  <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-3 md:min-w-[22rem]">
                    <div>
                      <p className="text-slate-500">Qty</p>
                      <p className="mt-1 font-medium text-white">{item.quantity}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Cost Basis</p>
                      <ClientPrice amountUsd={item.costBasisUsd} className="mt-1 block font-medium text-white" />
                    </div>
                    <div>
                      <p className="text-slate-500">Current</p>
                      <ClientPrice amountUsd={item.currentValueUsd} className="mt-1 block font-medium text-white" />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
