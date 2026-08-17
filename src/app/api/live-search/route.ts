import { NextResponse } from "next/server";

import {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  describeUnknownError,
  SEARCH_PAGE_SIZE,
  searchLiveCards,
} from "@/lib/pokemon-tcg-api";
import {
  SEARCH_UNAVAILABLE_NOTICE,
  shouldReplaceWithStaticTrending,
} from "@/lib/search-landing-fallback";
import { getStaticTrendingSearchResponse } from "@/lib/static-trending";
import type { CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isSearchSortOption(value: string): value is SearchSortOption {
  return [
    "relevance",
    "price-desc",
    "price-asc",
    "change-desc",
    "change-asc",
    "number-desc",
    "number-asc",
  ].includes(value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const setFilter = searchParams.get("set") ?? undefined;
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const requestedLanguage = searchParams.get("lang") ?? "all";
  const requestedSort = searchParams.get("sort") ?? DEFAULT_SEARCH_SORT;

  const language = CARD_LANGUAGE_FILTERS.some((item) => item.code === requestedLanguage)
    ? (requestedLanguage as CardLanguageFilter)
    : "all";
  const sort = isSearchSortOption(requestedSort) ? requestedSort : DEFAULT_SEARCH_SORT;
  const normalizedPage = Number.isNaN(page) || page < 1 ? 1 : page;

  try {
    let response = await searchLiveCards(
      query,
      setFilter || undefined,
      normalizedPage,
      language,
      sort,
    );

    if (
      shouldReplaceWithStaticTrending({
        query,
        setFilter,
        page: normalizedPage,
        resultsLength: response.results.length,
        notice: response.notice,
      })
    ) {
      response = getStaticTrendingSearchResponse();
    }

    // Never cache an empty result. A transient upstream failure (e.g. a blocked
    // official-catalog fetch) must not be frozen at the CDN for the full
    // stale-while-revalidate window, or the set looks permanently broken long
    // after the server has recovered. Non-empty pages are core identities only
    // (prices lazy-load client-side), so they are safe to hold at the edge.
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": response.results.length
          ? "public, s-maxage=3600, stale-while-revalidate=86400"
          : "no-store",
      },
    });
  } catch (error) {
    console.error("🔥 CRITICAL SEARCH FAILURE:", error);
    console.error("live-search route failed", {
      query,
      setFilter,
      page: normalizedPage,
      language,
      sort,
      error: describeUnknownError(error),
    });

    const fallback = shouldReplaceWithStaticTrending({
      query,
      setFilter,
      page: normalizedPage,
      resultsLength: 0,
      notice: SEARCH_UNAVAILABLE_NOTICE,
    })
      ? getStaticTrendingSearchResponse()
      : {
          results: [],
          totalCount: 0,
          page: normalizedPage,
          pageSize: SEARCH_PAGE_SIZE,
          hasNextPage: false,
          notice:
            setFilter && sort !== "relevance"
              ? "Price sorting took too long for this set. Try again in a moment, or switch to Relevance while prices load."
              : SEARCH_UNAVAILABLE_NOTICE,
        };

    return NextResponse.json(fallback, {
      status: 200,
      headers: {
        "Cache-Control": fallback.results.length
          ? "public, s-maxage=3600, stale-while-revalidate=86400"
          : "no-store",
      },
    });
  }
}
