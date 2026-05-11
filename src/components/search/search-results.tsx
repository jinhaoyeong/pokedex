"use client";

import Image from "next/image";
import Link from "next/link";

import { ClientPrice } from "@/components/client-price";
import type { SearchResult } from "@/types/pokemon";

export function SearchResults({
  results,
  query,
  totalCount,
  notice,
}: {
  results: SearchResult[];
  query: string;
  totalCount: number | null;
  notice?: string;
}) {
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
      {notice ? (
        <div className="rounded-3xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">
          {notice}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-semibold text-white">
          {query || typeof totalCount !== "number" ? "Search results" : "Trending & Hot Cards"}
        </h2>
        <p className="text-sm text-slate-400 sm:text-right">
          {typeof totalCount === "number"
            ? `${totalCount.toLocaleString()} matches for "${query || "Trending & Hot Cards"}"`
            : `Showing cards for "${query || "all cards"}"`}
        </p>
      </div>
      {results.map((result, index) => {
        const title =
          result.card.language !== "en" && result.card.localizedName?.trim()
            ? result.card.localizedName
            : result.card.name;

        return (
          <Link
            key={`${result.card.slug}__${index}`}
            href={`/cards/${result.card.slug}`}
            className="glass-card flex flex-col gap-5 rounded-3xl p-4 transition duration-200 hover:-translate-y-1 hover:border-yellow-200/45 sm:flex-row sm:items-center sm:p-5"
          >
            <div className="relative h-36 w-28 shrink-0 overflow-hidden rounded-2xl border border-yellow-200/20 bg-slate-950 shadow-lg shadow-black/30">
              <Image
                src={result.card.image}
                alt={title}
                fill
                sizes="(max-width: 640px) 25vw, 112px"
                priority={index < 6}
                className="object-contain p-2"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xl font-semibold text-white">{title}</p>
                  <p className="mt-1 break-words text-sm text-slate-400">
                    {result.card.setName} / #{result.card.collectorNumber} /{" "}
                    {result.card.rarity}
                  </p>
                </div>
                {result.card.marketPriceUsd > 0 ? (
                  <ClientPrice
                    amountUsd={result.card.marketPriceUsd}
                    className="text-xl font-semibold text-blue-300"
                  />
                ) : (
                  <span className="text-sm font-medium text-amber-200">
                    Price pending
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-300">
                <span className="type-chip rounded-full bg-blue-500/15 px-3 py-1 text-blue-200">
                  {result.card.languageLabel}
                </span>
                <span className="type-chip rounded-full px-3 py-1">
                  {result.matchReason}
                </span>
                <span className="type-chip rounded-full px-3 py-1">
                  {result.card.types.join(", ") || "Type pending"}
                </span>
                {result.card.imageStatus === "placeholder" ? (
                  <span className="rounded-full border border-slate-500/30 px-3 py-1 text-slate-300">
                    Source scan pending
                  </span>
                ) : null}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
