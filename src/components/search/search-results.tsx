"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { HoloTilt } from "@/components/fx/holo-tilt";
import { formatCardDisplayName, formatCardLanguageTag } from "@/lib/card-display-name";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { derivePriceStatus, statusClassName, statusLabel } from "@/lib/card-confidence";
import { useLazyCardPrice } from "@/hooks/use-lazy-card-price";
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
      className="object-contain"
      onError={() => {
        if (imageSrc !== "/icon.svg") {
          setImageSrc("/icon.svg");
        }
      }}
    />
  );
}

function SearchResultRow({
  result,
  index,
  suppressRepeatedPendingPrice,
}: {
  result: SearchResult;
  index: number;
  suppressRepeatedPendingPrice: boolean;
}) {
  const title = formatCardDisplayName(result.card);
  // Resolve the real market price client-side from the same source the card
  // detail page uses, so the list price matches the detail price instead of a
  // low server-side estimate.
  const { priceUsd, isLoading } = useLazyCardPrice(result.card);

  return (
    <Link
      href={`/cards/${result.card.slug}`}
      prefetch
      onClick={() => stashCardForNavigation(result.card)}
      className="search-result-card glass-card grid grid-cols-[5.25rem_minmax(0,1fr)] gap-4 rounded-3xl p-4 transition duration-200 hover:-translate-y-1 sm:flex sm:flex-row sm:items-center sm:gap-6 sm:p-6"
    >
      <HoloTilt className="relative aspect-[0.716/1] w-[5.25rem] shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-lg shadow-black/30 sm:w-32">
        <SearchResultImage src={result.card.image} alt={title} priority={index < 3} />
      </HoloTilt>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="break-words text-base font-semibold leading-tight text-white sm:text-xl">{title}</p>
            <p className="mt-1 break-words text-sm text-slate-400">
              {result.card.setName} &middot; #{result.card.collectorNumber}
            </p>
          </div>
          {priceUsd > 0 ? (
            <div className="sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Market
              </p>
              <ClientPrice
                amountUsd={priceUsd}
                className="break-words text-lg font-semibold leading-none text-[var(--text)] sm:text-2xl"
              />
            </div>
          ) : isLoading ? (
            <span className="text-sm font-medium text-slate-400">Loading price…</span>
          ) : suppressRepeatedPendingPrice ? null : (
            <span className="text-sm font-medium text-amber-200">Price pending</span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-4">
          {result.matchReason.startsWith("Learned") ? (
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${statusClassName(
                derivePriceStatus(result.card, null),
              )}`}
            >
              {statusLabel(derivePriceStatus(result.card, null))}
            </span>
          ) : null}
          <span className="result-chip">{result.card.rarity}</span>
          {result.card.language !== "en" ? (
            <span className="result-chip">{formatCardLanguageTag(result.card.language)}</span>
          ) : null}
          {result.card.types.length ? (
            <span className="result-chip">{result.card.types.join(" / ")}</span>
          ) : null}
          {result.card.imageStatus === "placeholder" ? (
            <span className="result-chip result-chip-warn">Scan pending</span>
          ) : null}
        </div>
      </div>
    </Link>
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
        {notice ? (
          <p className="mt-3 text-sm font-medium text-amber-100">{notice}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            Try a set code like `MEW` and a number like `203`, or search by card
            name.
          </p>
        )}
      </div>
    );
  }

  const allPricesPending = results.every((result) => result.card.marketPriceUsd <= 0);
  const suppressRepeatedPendingPrice = Boolean(pricePendingNotice && allPricesPending);

  return (
    <div className="space-y-6">
      {notice ? (
        <div className="rounded-3xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">
          {notice}
        </div>
      ) : null}
      {pricePendingNotice && allPricesPending ? (
        <div className="info-box info-box--accent text-sm font-semibold">
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
      {results.map((result, index) => (
        <SearchResultRow
          key={`${result.card.slug}__${index}`}
          result={result}
          index={index}
          suppressRepeatedPendingPrice={suppressRepeatedPendingPrice}
        />
      ))}
    </div>
  );
}
