"use client";

import { useEffect } from "react";

import { prefetchClientSearch, warmClientSearchCache } from "@/lib/client-catalog-cache";
import type {
  CardEditionFilter,
  CardLanguageFilter,
  LiveSearchResponse,
  SearchSortOption,
} from "@/types/pokemon";

export function SearchResultsCacheWarmer({
  cacheKey,
  response,
  query,
  setFilter,
  page,
  language,
  sort,
  edition,
}: {
  cacheKey: string;
  response: LiveSearchResponse;
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
  edition: CardEditionFilter;
}) {
  useEffect(() => {
    warmClientSearchCache(cacheKey, response, { setFilter });
  }, [cacheKey, response, setFilter]);

  useEffect(() => {
    if (!response.hasNextPage) {
      return;
    }

    const timer = window.setTimeout(() => {
      prefetchClientSearch({
        query,
        setFilter,
        page: page + 1,
        language,
        sort,
        edition,
      });
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [edition, language, page, query, response.hasNextPage, setFilter, sort]);

  useEffect(() => {
    if (page <= 1) {
      return;
    }

    prefetchClientSearch({
      query,
      setFilter,
      page: page - 1,
      language,
      sort,
      edition,
    });
  }, [edition, language, page, query, setFilter, sort]);

  return null;
}
