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
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { derivePriceStatus, statusClassName, statusLabel } from "@/lib/card-confidence";
import { useLazyCardPrice } from "@/hooks/use-lazy-card-price";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { officialJapaneseChaseSortScore } from "@/lib/pokemon-tcg/chase-sort-score";
import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import type { SearchResult, SearchSortOption, TcgCard } from "@/types/pokemon";

type PriceSortRegistry = {
  registerResolvedPrice: (slug: string, priceUsd: number | null) => void;
};

type ActiveFilterChip = {
  ariaLabel: string;
  href: string;
  label: string;
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
    <Link
      href={`/cards/${result.card.slug}`}
      prefetch
      onClick={() => stashCardForNavigation(result.card)}
      className="search-result-card glass-card"
    >
      <HoloTilt className="search-result-card-media relative overflow-hidden">
        <SearchResultImage src={result.card.image} alt={title} priority={index < 3} />
      </HoloTilt>
      <div className="search-result-card-body">
        <div className="search-result-card-main">
          <div className="search-result-card-identity">
            <p className="search-result-card-title">{title}</p>
            <p className="search-result-card-set">
              {result.card.setName} &middot; #{result.card.collectorNumber}
            </p>
          </div>
          {priceUsd > 0 ? (
            <div className="search-result-card-price">
              <div className="search-result-card-price-label">
                <p>
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
                className="result-price"
              />
            </div>
          ) : isLoading ? (
            <div
              className="search-result-card-price-loading"
              aria-label="Loading market price"
            >
              <span />
              <span />
            </div>
          ) : suppressRepeatedPendingPrice ? null : (
            <span className="search-result-card-pending">Price pending</span>
          )}
        </div>
        <div className="search-result-card-meta">
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
        <span className="search-result-card-cta">
          View card <span aria-hidden="true">&rarr;</span>
        </span>
      </div>
    </Link>
  );
}

export function SearchResults({
  activeFilterChips = [],
  clearHref = "/search",
  heading,
  pricePendingNotice,
  results,
  query,
  sort = DEFAULT_SEARCH_SORT,
  summary,
  totalCount,
  notice,
}: {
  activeFilterChips?: ActiveFilterChip[];
  clearHref?: string;
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
      <div className="dex-results-workspace">
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
        <div className="dex-results-toolbar">
          <div>
            <span className="premium-kicker">Browse</span>
            <h2>
              {heading ??
                (query || typeof totalCount !== "number"
                  ? "Search results"
                  : "Popular cards")}
            </h2>
          </div>
          <p aria-live="polite">
            {summary ??
              (typeof totalCount === "number"
                ? `${totalCount.toLocaleString()} cards ready to browse`
                : `Showing cards for "${query || "all cards"}"`)}
          </p>
        </div>
        {activeFilterChips.length ? (
          <div className="dex-active-filters" aria-label="Active search filters">
            {activeFilterChips.map((chip) => (
              <Link key={`${chip.label}:${chip.href}`} href={chip.href} aria-label={chip.ariaLabel}>
                {chip.label} <span aria-hidden="true">&times;</span>
              </Link>
            ))}
            {activeFilterChips.length > 1 ? <Link href={clearHref}>Clear all</Link> : null}
          </div>
        ) : null}
        <div className="dex-result-grid">
          {displayResults.map((result, index) => (
            <SearchResultRow
              key={result.card.slug}
              result={result}
              index={index}
              suppressRepeatedPendingPrice={suppressRepeatedPendingPrice}
            />
          ))}
        </div>
      </div>
    </PriceSortRegistryContext.Provider>
  );
}
