"use client";

import { useEffect, useState } from "react";

import { SearchResults } from "@/components/search/search-results";
import { applyEditionFilterToSearchResponse } from "@/lib/card-finish";
import {
  makeClientSearchCacheKey,
  warmClientSearchCache,
} from "@/lib/client-catalog-cache";
import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import {
  isLiveTrendingMatchReason,
  isStaticTrendingResponse,
} from "@/lib/trending";
import type {
  CardEditionFilter,
  CardLanguageFilter,
  LiveSearchResponse,
  SearchSortOption,
} from "@/types/pokemon";

/** Wait before each attempt. The first is immediate; the rest let the catalog warm. */
const REFRESH_BACKOFF_MS = [0, 1_200, 2_800];

function liveSearchHref(input: {
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
  edition: CardEditionFilter;
}) {
  const params = new URLSearchParams({
    q: input.query,
    page: String(input.page),
    lang: input.language,
    sort: input.sort,
    edition: input.edition,
  });
  if (input.setFilter) params.set("set", input.setFilter);
  return `/api/live-search?${params.toString()}`;
}

/**
 * A cold live catalog may miss the server streaming deadline. Keep the instant
 * bundled paint, then replace it in-place as soon as live 7-day momentum is
 * available instead of pinning the fallback for the entire page session.
 */
export function SearchResultsLiveRefresh({
  initialResponse,
  heading,
  summary,
  query,
  setFilter,
  page,
  language,
  sort,
  edition,
}: {
  initialResponse: LiveSearchResponse;
  heading: string;
  summary: string;
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
  edition: CardEditionFilter;
}) {
  const [response, setResponse] = useState(initialResponse);
  const [seeded, setSeeded] = useState(initialResponse);

  // React's documented "adjust state when a prop changes" pattern, and it has
  // to be here rather than in an effect: a useState initialiser reads its
  // argument once, so a better response arriving under the SAME key — a
  // router refresh, or a re-render of the section with warmer server data —
  // would otherwise be held off the screen by the copy we froze on mount.
  if (seeded !== initialResponse) {
    setSeeded(initialResponse);
    setResponse(initialResponse);
  }

  useEffect(() => {
    if (
      query.trim() ||
      setFilter.trim() ||
      page !== 1 ||
      sort !== DEFAULT_SEARCH_SORT ||
      !isStaticTrendingResponse(initialResponse.results)
    ) {
      return;
    }

    const controller = new AbortController();
    const args = { query, setFilter, page, language, sort, edition };
    const cacheKey = makeClientSearchCacheKey(args);

    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, ms);
        controller.signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });

    async function refresh() {
      // The bundled fallback is on screen precisely because the live catalog
      // was cold. Asking again in the same tick asks the same cold upstream
      // the same question, so each attempt gives it longer to warm — and the
      // route sends no-store with a static body, so a retry is never served
      // the fallback back out of a cache.
      for (const delay of REFRESH_BACKOFF_MS) {
        if (delay) {
          await pause(delay);
        }
        if (controller.signal.aborted) {
          return;
        }
        try {
          const fetched = await fetch(liveSearchHref(args), {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!fetched.ok) continue;
          const payload = (await fetched.json()) as LiveSearchResponse;
          if (!payload.results.some((result) => isLiveTrendingMatchReason(result.matchReason))) {
            continue;
          }
          const filtered = applyEditionFilterToSearchResponse(payload, edition);
          warmClientSearchCache(cacheKey, filtered);
          setResponse(filtered);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }
    }

    void refresh();
    return () => controller.abort();
  }, [edition, initialResponse, language, page, query, setFilter, sort]);

  const liveMomentum = response.results.some((result) =>
    isLiveTrendingMatchReason(result.matchReason),
  );

  return (
    <SearchResults
      heading={heading}
      results={response.results}
      query={query}
      sort={sort}
      summary={liveMomentum ? "Ranked by 7-day market momentum" : summary}
      totalCount={response.totalCount}
      notice={response.notice}
    />
  );
}
