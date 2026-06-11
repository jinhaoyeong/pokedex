"use client";

import { useEffect } from "react";

import { warmClientSearchCache } from "@/lib/client-catalog-cache";
import type { LiveSearchResponse } from "@/types/pokemon";

export function SearchResultsCacheWarmer({
  cacheKey,
  response,
}: {
  cacheKey: string;
  response: LiveSearchResponse;
}) {
  useEffect(() => {
    warmClientSearchCache(cacheKey, response);
  }, [cacheKey, response]);

  return null;
}
