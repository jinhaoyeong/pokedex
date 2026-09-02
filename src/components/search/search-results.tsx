"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type CSSProperties } from "react";
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
import { listCardImageDisplaySrc } from "@/lib/list-card-image";
import { displayableListPriceUsd } from "@/lib/price/list-price-trust";
import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import { buildSetSearchHref } from "@/lib/set-search-href";
import { useSearchNavigation } from "@/components/search/search-navigation";
import type {
  CardFinishId,
  SearchResult,
  SearchSortOption,
  TcgCard,
} from "@/types/pokemon";

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
  const displayPriceUsd = displayableListPriceUsd(result.card);
  const finishMarkets = result.card.finishMarkets ?? [];
  const showPrice = displayPriceUsd > 0;
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
        {showPrice ? (
          <>
            <p className="search-result-market-label">Market</p>
            <div className="search-result-price-row">
              <ClientPrice
                amountUsd={displayPriceUsd}
                className="result-price search-result-price-value"
              />
            </div>
          </>
        ) : (
          <div
            className="search-result-market-unavailable"
            aria-label="Market price unavailable"
          >
            <p className="search-result-market-label">Market</p>
            <span>Unavailable</span>
          </div>
        )}
      </div>
    </article>
  );
}

export function SearchResults({
  heading,
  results,
  query,
  sort: _sort = DEFAULT_SEARCH_SORT,
  summary,
  totalCount,
  notice,
}: {
  heading?: string;
  results: SearchResult[];
  query: string;
  sort?: SearchSortOption;
  summary?: string;
  totalCount: number | null;
  notice?: string;
}) {
  const { ref: resultsRef, phase: resultsPhase } = usePrintOnView<HTMLElement>();
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

      <div className="search-results-grid-stage">
        <div className={`${SEARCH_RESULT_GRID_CLASS} search-results-grid-real`}>
          {results.map((result, index) => {
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
      </div>
    </section>
  );
}
