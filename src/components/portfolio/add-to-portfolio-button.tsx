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
    <div className="glass-card rounded-3xl p-6">
      <h3 className="text-lg font-semibold text-white">Add to portfolio</h3>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <select
          aria-label="Select grade"
          value={grade}
          onChange={(event) => setGrade(event.target.value as GradeLabel)}
          className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
        >
          {card.gradedPrices.map((price) => (
            <option key={price.grade} value={price.grade}>
              {price.grade}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addCard}
          className="rounded-2xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-400"
        >
          Add Card
        </button>
      </div>
      {status ? <p className="mt-3 text-sm text-emerald-300">{status}</p> : null}
    </div>
  );
}
