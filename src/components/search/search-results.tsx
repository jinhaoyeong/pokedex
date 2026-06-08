"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { PriceConfidenceBadge } from "@/components/search/price-confidence-badge";
import { getPriceDisplayMeta } from "@/lib/catalog/price-confidence";
import type { SearchResult } from "@/types/pokemon";

function SearchResultImage({
  alt,
  priority,
  src,
}: {
  alt: string;
  priority: boolean;
  src: string;
}) {
  const [imageSrc, setImageSrc] = useState(src);

  return (
    <Image
      src={imageSrc}
      alt={alt}
      fill
      sizes="(max-width: 640px) 25vw, 112px"
      priority={priority}
      className="object-contain p-2"
      onError={() => {
        if (imageSrc !== "/icon.svg") {
          setImageSrc("/icon.svg");
        }
      }}
    />
  );
}

export function SearchResults({
  heading,
  pricePendingNotice,
  results,
  query,
  summary,
  totalCount,
  notice,
}: {
  heading?: string;
  pricePendingNotice?: string;
  results: SearchResult[];
  query: string;
  summary?: string;
  totalCount: number | null;
  notice?: string;
}) {
  if (!results.length) {
    return (
      <div className="glass-card rounded-3xl p-5 text-center sm:p-8">
        <p className="text-lg font-medium text-white">No cards found.</p>
        <p className="mt-2 text-sm text-slate-400">
          Try a set code like `MEW` and a number like `203`, or search by card
          name.
        </p>
      </div>
    );
  }

  const allPricesPending = results.every((result) => result.card.marketPriceUsd <= 0);
  const suppressRepeatedPendingPrice = Boolean(pricePendingNotice && allPricesPending);

  return (
    <div className="search-results relative z-[1] space-y-6">
      {notice ? (
        <div className="rounded-3xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">
          {notice}
        </div>
      ) : null}
      {pricePendingNotice && allPricesPending ? (
        <div className="rounded-3xl border border-yellow-300/25 bg-yellow-300/10 p-4 text-sm font-bold text-yellow-100">
          {pricePendingNotice}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-2xl font-semibold text-white">
          {heading ??
            (query || typeof totalCount !== "number"
              ? "Search results"
              : "Trending & Hot Cards")}
        </h2>
        <p className="text-sm text-slate-400 sm:text-right">
          {summary ??
            (typeof totalCount === "number"
              ? `${totalCount.toLocaleString()} matches for "${query || "Trending & Hot Cards"}"`
              : `Showing cards for "${query || "all cards"}"`)}
        </p>
      </div>
      {results.map((result, index) => {
        const title =
          result.card.language !== "en" && result.card.localizedName?.trim()
            ? result.card.localizedName
            : result.card.name;

        let priceMeta;
        try {
          priceMeta = getPriceDisplayMeta(result.card);
        } catch {
          priceMeta = {
            label: "Pending",
            confidence: "low" as const,
            confidenceScore: 0.15,
            isEstimate: true,
            isEnglishCompanion: false,
          };
        }

        return (
          <Link
            key={`${result.card.slug}__${index}`}
            href={`/cards/${result.card.slug}`}
            className="search-result-card glass-card grid cursor-pointer grid-cols-[5.25rem_minmax(0,1fr)] gap-4 rounded-3xl p-4 transition duration-200 hover:-translate-y-1 hover:border-yellow-200/45 sm:flex sm:flex-row sm:items-center sm:gap-6 sm:p-6"
          >
            <div className="pointer-events-none relative h-32 w-[5.25rem] shrink-0 overflow-hidden rounded-2xl border border-yellow-200/20 bg-slate-950 shadow-lg shadow-black/30 sm:h-40 sm:w-32">
              <SearchResultImage
                src={result.card.image}
                alt={title}
                priority={index < 6}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold leading-tight text-white sm:text-xl">{title}</p>
                  <p className="mt-1 break-words text-sm text-slate-400">
                    {result.card.setName} / #{result.card.collectorNumber} /{" "}
                    {result.card.rarity}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {result.card.marketPriceUsd > 0 ? (
                    <ClientPrice
                      amountUsd={result.card.marketPriceUsd}
                      className="break-words text-base font-semibold text-blue-300 sm:text-xl"
                    />
                  ) : suppressRepeatedPendingPrice ? null : (
                    <span className="text-sm font-medium text-amber-200">
                      Price pending
                    </span>
                  )}
                  <PriceConfidenceBadge meta={priceMeta} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 sm:mt-4 sm:text-xs">
                <span>{result.card.languageLabel}</span>
                <span>{result.matchReason}</span>
                <span>{result.card.types.join(", ") || "Type pending"}</span>
                {result.card.imageStatus === "placeholder" ? (
                  <span className="text-amber-200">
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
