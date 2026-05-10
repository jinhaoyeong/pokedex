"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import {
  getAllManualPsaPopulationSnapshots,
  subscribeToManualPsaPopulationSnapshots,
} from "@/lib/manual-psa-pop-store";
import {
  getPrimaryPsaPopulationLabel,
  mergePsaPopulationSnapshot,
} from "@/lib/psa-population";
import type { PsaPopulationSnapshot, SearchResult } from "@/types/pokemon";

export function SearchResults({
  results,
  query,
}: {
  results: SearchResult[];
  query: string;
}) {
  const [manualSnapshots, setManualSnapshots] = useState<
    Record<string, PsaPopulationSnapshot>
  >({});

  useEffect(() => {
    const sync = () => {
      setManualSnapshots(getAllManualPsaPopulationSnapshots());
    };

    sync();
    return subscribeToManualPsaPopulationSnapshots(sync);
  }, []);

  if (!results.length) {
    return (
      <div className="glass-card rounded-3xl p-8 text-center">
        <p className="text-lg font-medium text-white">No cards found.</p>
        <p className="mt-2 text-sm text-slate-400">
          Try a set code like `MEW` and a number like `203`, or search by card
          name.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold text-white">Search results</h2>
        <p className="text-sm text-slate-400">
          {results.length} matches for &quot;{query || "all cards"}&quot;
        </p>
      </div>
      {results.map((result) => {
        const population = mergePsaPopulationSnapshot(
          result.card.psaPopulation,
          manualSnapshots[result.card.id],
        );
        const populationLabel = getPrimaryPsaPopulationLabel(population);

        return (
          <Link
            key={result.card.id}
            href={`/cards/${result.card.id}`}
            className="glass-card flex flex-col gap-5 rounded-3xl p-5 transition-transform duration-200 hover:-translate-y-1 sm:flex-row sm:items-center"
          >
            <div className="relative h-36 w-28 overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
              <Image
                src={result.card.image}
                alt={result.card.name}
                fill
                sizes="112px"
                className="object-contain p-2"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xl font-semibold text-white">{result.card.name}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {result.card.setName} · #{result.card.collectorNumber} ·{" "}
                    {result.card.rarity}
                  </p>
                </div>
                <ClientPrice
                  amountUsd={result.card.marketPriceUsd}
                  className="text-xl font-semibold text-blue-300"
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 px-3 py-1">
                  {result.matchReason}
                </span>
                <span
                  className={`rounded-full border px-3 py-1 ${
                    population.status === "verified"
                      ? "border-white/10"
                      : "border-amber-400/20 text-amber-200"
                  }`}
                >
                  {populationLabel}
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1">
                  {result.card.types.join(", ") || "Type pending"}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
