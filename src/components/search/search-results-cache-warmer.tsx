"use client";

import { useEffect } from "react";

import { prefetchClientSearch, warmClientSearchCache } from "@/lib/client-catalog-cache";
import type { CardLanguageFilter, LiveSearchResponse, SearchSortOption } from "@/types/pokemon";

export function SearchResultsCacheWarmer({
  cacheKey,
  response,
  query,
  setFilter,
  page,
  language,
  sort,
}: {
  cacheKey: string;
  response: LiveSearchResponse;
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
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
      });
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [language, page, query, response.hasNextPage, setFilter, sort]);

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
    });
  }, [language, page, query, setFilter, sort]);

  return null;
}
