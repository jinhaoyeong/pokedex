"use client";

import { useState } from "react";

import { readPortfolio, writePortfolio } from "@/lib/portfolio-store";
import type { GradeLabel, PortfolioItem, TcgCard } from "@/types/pokemon";

export function AddToPortfolioButton({ card }: { card: TcgCard }) {
  const [grade, setGrade] = useState<GradeLabel>("Ungraded");
  const [status, setStatus] = useState<string>("");

  const addCard = () => {
    const currentPortfolio = readPortfolio();

    const nextItem: PortfolioItem = {
      cardId: card.id,
      slug: card.slug,
      name: card.name,
      setName: card.setName,
      collectorNumber: card.collectorNumber,
      image: card.image,
      quantity: card.portfolioDefaultQuantity,
      grade,
      costBasisUsd:
        card.gradedPrices.find((price) => price.grade === grade)?.value ??
        card.marketPriceUsd,
      addedAt: new Date().toISOString(),
    };

    writePortfolio([...currentPortfolio, nextItem]);

    setStatus("Added to portfolio");
  };

  return (
    <div className="glass-card relative overflow-hidden rounded-3xl border-yellow-200/20 p-4 sm:p-6">
      <div className="absolute -right-10 -top-10 h-20 w-20 rounded-full border-[10px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:-right-8 sm:-top-8 sm:h-24 sm:w-24 sm:border-[12px] sm:opacity-35" />
      <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
        Binder capture
      </p>
      <h3 className="mt-2 text-lg font-black text-white">Add to portfolio</h3>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <select
          aria-label="Select grade"
          value={grade}
          onChange={(event) => setGrade(event.target.value as GradeLabel)}
          className="min-w-0 rounded-2xl border border-yellow-200/25 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-yellow-300/70 sm:flex-1"
        >
          {card.gradedPrices.map((price) => (
            <option key={price.grade} value={price.grade} className="bg-slate-950 text-white">
              {price.grade}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addCard}
          className="trainer-button rounded-2xl bg-blue-500 px-5 py-3 text-sm font-black text-white sm:shrink-0"
        >
          Add Card
        </button>
      </div>
      {status ? <p className="mt-3 text-sm text-emerald-300">{status}</p> : null}
    </div>
  );
}
