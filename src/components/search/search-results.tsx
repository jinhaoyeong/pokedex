"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { preload } from "react-dom";

import { ClientPrice } from "@/components/client-price";
import { ListCardImage } from "@/components/card/list-card-image";
import { HoloTilt } from "@/components/fx/holo-tilt";
import { usePrintOnView } from "@/components/fx/use-print-on-view";
import { formatCardDisplayName, formatCardLanguageTag } from "@/lib/card-display-name";
import {
  SEARCH_RESULT_EAGER_IMAGE_COUNT,
  SEARCH_RESULT_GRID_CLASS,
} from "@/lib/search-result-grid";
import { finishLabel, finishShortLabel } from "@/lib/card-finish";
import { prefetchClientSearch, stashCardForNavigation } from "@/lib/client-catalog-cache";
import { derivePriceStatus, statusClassName, statusLabel } from "@/lib/card-confidence";
import { useLazyCardPrice } from "@/hooks/use-lazy-card-price";
import { listCardImageDisplaySrc } from "@/lib/list-card-image";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { officialJapaneseChaseSortScore } from "@/lib/pokemon-tcg/chase-sort-score";
import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import { buildSetSearchHref } from "@/lib/set-search-href";
import { useSearchNavigation } from "@/components/search/search-navigation";
import type {
  CardFinishId,
  SearchResult,
  SearchSortOption,
  TcgCard,
} from "@/types/pokemon";

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

function SearchSetNameLink({
  card,
  children,
}: {
  card: TcgCard;
  children: React.ReactNode;
}) {
  const href = buildSetSearchHref(card);
  const router = useRouter();
  const { beginSearchNavigation } = useSearchNavigation();
  const [, startTransition] = useTransition();

  return (
    <Link
      href={href}
      prefetch
      title={`Open cards in ${card.setName}`}
      className="search-set-link pointer-events-auto relative z-20 min-w-0 truncate"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        prefetchClientSearch({
          query: "",
          setFilter: card.setId || card.setCode,
          page: 1,
          language: card.language && card.language !== "en" ? card.language : "en",
          sort: "number-asc",
        });
        beginSearchNavigation();
        startTransition(() => {
          router.push(href);
        });
      }}
    >
      {children}
    </Link>
  );
}

function normalizeFinishTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// The rarity already spells the finish out on plenty of prints ("1st Edition
// Rare Holo" sitting above "1st Edition holo"), so drop the finish chip when it
// repeats a fact the rarity chip has already stated.
function finishIsImpliedByRarity(
  finish: CardFinishId,
  rarity: string | null | undefined,
) {
  if (!rarity) {
    return false;
  }

  const rarityTokens = new Set(normalizeFinishTokens(rarity));

  return normalizeFinishTokens(finishLabel(finish)).every((token) =>
    rarityTokens.has(token),
  );
}

function SearchResultTile({
  result,
  index,
}: {
  result: SearchResult;
  index: number;
}) {
  const title = formatCardDisplayName(result.card);
  // Resolve the real market price client-side from the same source the card
  // detail page uses, so the list price matches the detail price instead of a
  // low server-side estimate.
  const { priceUsd, isLoading, isEstimate } = useLazyCardPrice(result.card);
  const priceSortRegistry = useContext(PriceSortRegistryContext);
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

  const selectedFinish = result.card.finish;

  return (
    <article
      className="search-result-tile group relative isolate flex h-full min-w-0 flex-col"
      style={{ "--row": index } as CSSProperties}
    >
      <Link
        href={`/cards/${result.card.slug}`}
        prefetch={index < 4}
        onClick={() => stashCardForNavigation(result.card)}
        aria-label={title}
        className="absolute inset-0 z-0"
      />
      <div className="search-result-art pointer-events-none relative z-10 mx-auto">
        <HoloTilt
          allowTouch={false}
          className="search-result-art-frame list-card-art-frame relative aspect-[0.716/1] w-full overflow-hidden rounded-[0.72rem]"
        >
          <ListCardImage
            src={result.card.image}
            alt={title}
            priority={index < SEARCH_RESULT_EAGER_IMAGE_COUNT}
            setCode={result.card.setCode}
            number={result.card.collectorNumber}
          />
        </HoloTilt>
      </div>
      <div className="search-result-copy pointer-events-none relative z-10 mt-3 flex min-h-0 min-w-0 flex-col">
        <p className="search-result-title line-clamp-2">{title}</p>
        <p className="search-result-set min-w-0">
          <SearchSetNameLink card={result.card}>{result.card.setName}</SearchSetNameLink>
          <span className="search-result-number">#{result.card.collectorNumber}</span>
        </p>
        <div className="search-result-attributes">
          {result.card.rarity ? (
            <span className="search-result-tag">{result.card.rarity}</span>
          ) : null}
          {result.card.language !== "en" ? (
            <span className="search-result-tag search-result-tag-lang">
              {formatCardLanguageTag(result.card.language)}
            </span>
          ) : null}
          {finishMarkets.length > 1 ? (
            finishMarkets.map((finish) => (
              <Link
                key={finish.id}
                href={`/cards/${result.card.slug}?finish=${finish.id}`}
                prefetch
                onClick={() =>
                  stashCardForNavigation({ ...result.card, finish: finish.id })
                }
                className="search-result-tag search-result-tag-link pointer-events-auto relative z-20"
                title={`${finish.label} market for this print`}
              >
                {finishShortLabel(finish.id)}
                {finish.ungradedUsd > 0
                  ? ` $${finish.ungradedUsd.toFixed(finish.ungradedUsd >= 100 ? 0 : 2)}`
                  : ""}
              </Link>
            ))
          ) : selectedFinish &&
            !finishIsImpliedByRarity(selectedFinish, result.card.rarity) ? (
            <span className="search-result-tag">{finishLabel(selectedFinish)}</span>
          ) : null}
        </div>
        {result.matchReason.startsWith("Learned") ? (
          <span
            className={`search-result-badge w-fit ${statusClassName(
              derivePriceStatus(result.card, null),
            )}`}
          >
            {statusLabel(derivePriceStatus(result.card, null))}
          </span>
        ) : null}
        {result.card.imageStatus === "placeholder" ? (
          <span className="search-result-tag w-fit" title="No card image is published for this print">
            No art
          </span>
        ) : null}
      </div>
      <div className="search-result-rule" aria-hidden="true" />
      <div className="search-result-market">
        {priceUsd > 0 ? (
          <>
            <p className="search-result-market-label">Market</p>
            <div className="search-result-price-row">
              <ClientPrice
                amountUsd={priceUsd}
                className="result-price search-result-price-value"
              />
              {isEstimate ? (
                <span
                  title="Estimated price — refining to the verified market value"
                  className={`search-result-est ${statusClassName("estimated")}`}
                >
                  {statusLabel("estimated")}
                </span>
              ) : null}
            </div>
          </>
        ) : isLoading ? (
          <div className="search-result-market-loading" aria-label="Loading market price">
            <p className="search-result-market-label">Market</p>
            <span className="search-result-price-skeleton" />
          </div>
        ) : null}
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
  const { ref: resultsRef, phase: resultsPhase } = usePrintOnView<HTMLElement>();
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

  const summaryLine =
    summary ?? (typeof totalCount === "number" ? `${totalCount.toLocaleString()} cards` : "");

  if (!results.length) {
    return (
      <section className="sheet results-sheet">
        <header className="sheet-band">
          <h2 className="sheet-band-title">No results</h2>
        </header>
        <div className="results-empty">
          <p className="results-empty-title">Nothing found</p>
          <p className="results-empty-note">
            {notice ?? "Try a card name, a set code, or a collector number."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <PriceSortRegistryContext.Provider
      value={isPriceSort(sort) ? priceSortRegistry : null}
    >
      <section
        className="sheet results-sheet search-results-list"
        ref={resultsRef}
        data-print={resultsPhase}
      >
        <header className="sheet-band">
          <h2 className="sheet-band-title">
            {heading ?? (query ? "Results" : "Trending")}
          </h2>
          {summaryLine ? (
            <p className="sheet-meta">
              <span>{summaryLine}</span>
            </p>
          ) : null}
        </header>

        {notice ? (
          <p className="results-notice" data-tone="warn">
            {notice}
          </p>
        ) : null}
        {pricePendingNotice && allPricesPending ? (
          <p className="results-notice">{pricePendingNotice}</p>
        ) : null}

        <div className={SEARCH_RESULT_GRID_CLASS}>
          {displayResults.map((result, index) => {
            if (index < SEARCH_RESULT_EAGER_IMAGE_COUNT) {
              const src = listCardImageDisplaySrc(result.card.image);
              if (src && src !== "/icon.svg") {
                preload(src, { as: "image" });
              }
            }

            return (
              <SearchResultTile
                key={result.card.slug}
                result={result}
                index={index}
              />
            );
          })}
        </div>
      </section>
    </PriceSortRegistryContext.Provider>
  );
}
