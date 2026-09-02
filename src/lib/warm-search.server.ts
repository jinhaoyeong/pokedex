import "server-only";

import { makePricedSearchCacheKey, searchLiveCards } from "@/lib/pokemon-tcg-api";
import { readSearchResult } from "@/lib/search-result-store.server";
import { readSetBrowseHits } from "@/lib/shared-search-cache.server";
import {
  selectWarmSearchJobs,
  type WarmSearchJob,
} from "@/lib/warm-search-plan";
import type { LiveSearchResponse } from "@/types/pokemon";

const FRESH_PRICED_TTL_MS = 45 * 60 * 1000;
const MIN_PRICED_TILES = 8;

function searchLooksWarm(response: LiveSearchResponse | null) {
  if (!response?.results.length) {
    return false;
  }

  const priced = response.results.filter((result) => result.card.marketPriceUsd > 0).length;
  return priced >= Math.min(MIN_PRICED_TILES, response.results.length);
}

export async function runWarmSearchJobs(jobs?: WarmSearchJob[]) {
  const hits = await readSetBrowseHits();
  const planned = jobs ?? selectWarmSearchJobs(hits);
  const startedAt = Date.now();
  const warmed: Array<{ job: WarmSearchJob; ms: number; results: number; priced: number }> = [];
  const skipped: WarmSearchJob[] = [];
  const failed: Array<{ job: WarmSearchJob; error: string }> = [];

  for (const job of planned) {
    const cacheKey = makePricedSearchCacheKey("", job.setId, 1, job.language, job.sort);
    const existing = await readSearchResult<LiveSearchResponse>(cacheKey, FRESH_PRICED_TTL_MS);

    if (searchLooksWarm(existing)) {
      skipped.push(job);
      continue;
    }

    const jobStarted = Date.now();
    try {
      const response = await searchLiveCards("", job.setId, 1, job.language, job.sort);
      const priced = response.results.filter((result) => result.card.marketPriceUsd > 0).length;
      warmed.push({
        job,
        ms: Date.now() - jobStarted,
        results: response.results.length,
        priced,
      });
    } catch (error) {
      failed.push({
        job,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    planned: planned.length,
    warmed,
    skipped: skipped.length,
    failed,
    elapsedMs: Date.now() - startedAt,
  };
}
