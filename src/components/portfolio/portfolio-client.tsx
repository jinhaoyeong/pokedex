"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

import { ClientPrice } from "@/components/client-price";
import { getCards } from "@/lib/cards";
import { readPortfolio, subscribeToPortfolio } from "@/lib/portfolio-store";

export function PortfolioClient() {
  const items = useSyncExternalStore(subscribeToPortfolio, readPortfolio, () => []);

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
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="glass-card rounded-3xl p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">
            Holdings
          </p>
          <p className="mt-3 text-3xl font-semibold text-white">{enrichedItems.length}</p>
        </div>
        <div className="glass-card rounded-3xl p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">
            Total Value
          </p>
          <ClientPrice amountUsd={totalValueUsd} className="mt-3 block text-3xl font-semibold text-white" />
        </div>
        <div className="glass-card rounded-3xl p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">
            Unrealized P/L
          </p>
          <ClientPrice
            amountUsd={totalValueUsd - totalCostUsd}
            className={`mt-3 block text-3xl font-semibold ${
              totalValueUsd >= totalCostUsd ? "text-emerald-300" : "text-rose-300"
            }`}
          />
        </div>
      </section>

      <section className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold text-white">Portfolio items</h2>
          <Link
            href="/search"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 hover:text-white"
          >
            Add more cards
          </Link>
        </div>

        {enrichedItems.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-white/10 p-8 text-center">
            <p className="text-lg font-medium text-white">No cards added yet.</p>
            <p className="mt-2 text-sm text-slate-400">
              Add cards from the detail page to start tracking your collection.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {enrichedItems.map((item) => (
              <article
                key={`${item.cardId}-${item.grade}-${item.addedAt}`}
                className="rounded-3xl border border-white/10 bg-white/4 p-5"
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
                  <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
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
