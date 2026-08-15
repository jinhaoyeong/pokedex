"use client";

import Image from "next/image";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ClientPrice } from "@/components/client-price";
import { HoloTilt } from "@/components/fx/holo-tilt";
import { formatCardDisplayName, formatCardLanguageTag } from "@/lib/card-display-name";
import { finishShortLabel } from "@/lib/card-finish";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { derivePriceStatus, statusClassName, statusLabel } from "@/lib/card-confidence";
import { useLazyCardPrice } from "@/hooks/use-lazy-card-price";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { officialJapaneseChaseSortScore } from "@/lib/pokemon-tcg/chase-sort-score";
import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import { buildSetSearchHref } from "@/lib/set-search-href";
import type { SearchResult, SearchSortOption, TcgCard } from "@/types/pokemon";

type PriceSortRegistry = {
  registerResolvedPrice: (slug: string, priceUsd: number | null) => void;
};

const PriceSortRegistryContext = createContext<PriceSortRegistry | null>(null);

function isPriceSort(sort: SearchSortOption) {
  return sort === "price-desc" || sort === "price-asc";
}

function compareByPriceSort(
  leftCard: TcgCard,
  rightCard: TcgCard,
  leftPrice: number,
  rightPrice: number,
  sort: SearchSortOption,
) {
  if (sort === "price-desc") {
    if (leftPrice > 0 && rightPrice <= 0) {
      return -1;
    }

    if (rightPrice > 0 && leftPrice <= 0) {
      return 1;
    }

    if (leftPrice > 0 && rightPrice > 0) {
      return rightPrice - leftPrice || leftCard.name.localeCompare(rightCard.name);
    }

    // Both unpriced: keep chase prints (ex/mega/secret) above commons so page 1
    // is not alphabetical filler while lazy /api/price is still resolving.
    return (
      officialJapaneseChaseSortScore(rightCard) - officialJapaneseChaseSortScore(leftCard) ||
      leftCard.name.localeCompare(rightCard.name)
    );
  }

  const leftAsc = leftPrice > 0 ? leftPrice : Number.POSITIVE_INFINITY;
  const rightAsc = rightPrice > 0 ? rightPrice : Number.POSITIVE_INFINITY;

  if (leftAsc === rightAsc && !(leftPrice > 0) && !(rightPrice > 0)) {
    return (
      officialJapaneseChaseSortScore(rightCard) - officialJapaneseChaseSortScore(leftCard) ||
      leftCard.name.localeCompare(rightCard.name)
    );
  }

  return leftAsc - rightAsc || leftCard.name.localeCompare(rightCard.name);
}

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
      unoptimized
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
  const { priceUsd, isLoading, isEstimate } = useLazyCardPrice(result.card);
  const priceSortRegistry = useContext(PriceSortRegistryContext);
  const setHref = buildSetSearchHref(result.card);
  const finishMarkets = result.card.finishMarkets ?? [];

  useEffect(() => {
    // Only publish settled prices. Registering 0 while lazy-load is in flight
    // overwrote server headlines via `??` and left unpriced rows above priced ones.
    if (isLoading) {
      return;
    }

    priceSortRegistry?.registerResolvedPrice(
      result.card.slug,
      priceUsd > 0 ? priceUsd : null,
    );
  }, [priceSortRegistry, result.card.slug, priceUsd, isLoading]);

  return (
    <article className="search-result-card glass-card relative grid grid-cols-[5.25rem_minmax(0,1fr)] gap-4 rounded-3xl p-4 sm:flex sm:flex-row sm:items-center sm:gap-6 sm:p-6">
      <Link
        href={`/cards/${result.card.slug}`}
        prefetch
        onClick={() => stashCardForNavigation(result.card)}
        aria-label={title}
        className="absolute inset-0 z-0 rounded-3xl"
      />
      <HoloTilt className="pointer-events-none relative z-10 aspect-[0.716/1] w-[5.25rem] shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-lg shadow-black/30 sm:w-32">
        <SearchResultImage src={result.card.image} alt={title} priority={index < 3} />
      </HoloTilt>
      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="break-words text-base font-semibold leading-tight text-white sm:text-xl">{title}</p>
            <p className="mt-1 break-words text-sm text-slate-400">
              <Link
                href={setHref}
                prefetch
                title={`Open cards in ${result.card.setName}`}
                className="search-set-link pointer-events-auto relative z-20 text-sky-200 underline-offset-2 hover:text-white hover:underline"
              >
                {result.card.setName}
              </Link>
              {" "}&middot; #{result.card.collectorNumber}
            </p>
          </div>
          {priceUsd > 0 ? (
            <div className="sm:text-right">
              <div className="flex items-center gap-1.5 sm:justify-end">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                  Market
                </p>
                {isEstimate ? (
                  <span
                    title="Estimated price — refining to the verified market value"
                    className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${statusClassName(
                      "estimated",
                    )}`}
                  >
                    {statusLabel("estimated")}
                  </span>
                ) : null}
              </div>
              <ClientPrice
                amountUsd={priceUsd}
                className="result-price break-words text-lg font-semibold leading-none text-[var(--text)] sm:text-2xl"
              />
            </div>
          ) : isLoading ? (
            <div
              className="min-w-[7.5rem] sm:text-right"
              aria-label="Loading market price"
            >
              <span className="mb-2 ml-auto block h-2.5 w-14 animate-pulse rounded-full bg-white/10" />
              <span className="ml-auto block h-6 w-28 max-w-full animate-pulse rounded-md bg-white/10 sm:h-7" />
            </div>
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
          {finishMarkets.length > 1
            ? finishMarkets.map((finish) => (
                <Link
                  key={finish.id}
                  href={`/cards/${result.card.slug}?finish=${finish.id}`}
                  prefetch
                  onClick={() =>
                    stashCardForNavigation({ ...result.card, finish: finish.id })
                  }
                  className="result-chip pointer-events-auto relative z-20 border-sky-300/20 text-sky-100"
                  title={`${finish.label} market for this print`}
                >
                  {finishShortLabel(finish.id)}
                  {finish.ungradedUsd > 0
                    ? ` $${finish.ungradedUsd.toFixed(finish.ungradedUsd >= 100 ? 0 : 2)}`
                    : ""}
                </Link>
              ))
            : null}
        </div>
      </div>
    </article>
  );
}

export function SearchResults({
  heading,
  pricePendingNotice,
  results,
  query,
  sort = DEFAULT_SEARCH_SORT,
  summary,
  totalCount,
  notice,
}: {
  heading?: string;
  pricePendingNotice?: string;
  results: SearchResult[];
  query: string;
  sort?: SearchSortOption;
  summary?: string;
  totalCount: number | null;
  notice?: string;
}) {
  const resultsKey = useMemo(
    () => results.map((result) => result.card.slug).join("\u0000"),
    [results],
  );
  const [resolvedPricesByKey, setResolvedPricesByKey] = useState<{
    key: string;
    prices: Record<string, number>;
  }>(() => ({ key: resultsKey, prices: {} }));
  const resolvedPrices = useMemo(
    () => (resolvedPricesByKey.key === resultsKey ? resolvedPricesByKey.prices : {}),
    [resolvedPricesByKey, resultsKey],
  );

  const registerResolvedPrice = useCallback(
    (slug: string, priceUsd: number | null) => {
      setResolvedPricesByKey((previous) => {
        const prices = previous.key === resultsKey ? previous.prices : {};

        if (priceUsd == null || !(priceUsd > 0)) {
          if (!(slug in prices)) {
            return previous.key === resultsKey ? previous : { key: resultsKey, prices };
          }

          const nextPrices = { ...prices };
          delete nextPrices[slug];
          return { key: resultsKey, prices: nextPrices };
        }

        if (prices[slug] === priceUsd) {
          return previous.key === resultsKey
            ? previous
            : { key: resultsKey, prices };
        }

        return { key: resultsKey, prices: { ...prices, [slug]: priceUsd } };
      });
    },
    [resultsKey],
  );

  const priceSortRegistry = useMemo(
    () => ({ registerResolvedPrice }),
    [registerResolvedPrice],
  );

  const displayResults = useMemo(() => {
    if (!isPriceSort(sort)) {
      return results;
    }

    const next = results.slice();

    next.sort((left, right) =>
      compareByPriceSort(
        left.card,
        right.card,
        resolvedPrices[left.card.slug] ?? getHeadlineMarketPriceUsd(left.card),
        resolvedPrices[right.card.slug] ?? getHeadlineMarketPriceUsd(right.card),
        sort,
      ),
    );

    return next;
  }, [results, resolvedPrices, sort]);

  const allPricesPending = results.every(
    (result) =>
      !(
        (resolvedPrices[result.card.slug] ?? getHeadlineMarketPriceUsd(result.card)) > 0
      ),
  );
  const suppressRepeatedPendingPrice = Boolean(pricePendingNotice && allPricesPending);

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

  return (
    <PriceSortRegistryContext.Provider
      value={isPriceSort(sort) ? priceSortRegistry : null}
    >
      <div className="space-y-4">
        {notice ? (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5 text-sm font-bold text-amber-100">
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
        {displayResults.map((result, index) => (
          <SearchResultRow
            key={result.card.slug}
            result={result}
            index={index}
            suppressRepeatedPendingPrice={suppressRepeatedPendingPrice}
          />
        ))}
      </div>
    </PriceSortRegistryContext.Provider>
  );
}
