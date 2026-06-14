import { NextResponse } from "next/server";

import {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  searchLiveCards,
} from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

export const maxDuration = 60;
export const runtime = "nodejs";

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

  const response = await searchLiveCards(
    query,
    setFilter || undefined,
    normalizedPage,
    language,
    sort,
  );

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
    },
  });
}
