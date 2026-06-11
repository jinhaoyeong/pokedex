import {
  getCachedClientSets,
  makeClientSearchCacheKey,
  uniqueSetsById,
  warmClientSearchCache,
  warmClientCardCacheFromApi,
  warmClientSetsCache,
} from "@/lib/client-catalog-cache";
import type { CardLanguageFilter, LiveSearchResponse, TcgSet } from "@/types/pokemon";

const WARM_LANGUAGES: CardLanguageFilter[] = ["all", "en", "ja", "ko", "zh-cn"];
const SET_BROWSE_WARMUP_PER_LANGUAGE = 10;
const SEARCH_CONCURRENCY = 2;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
}

async function fetchClientSets(language: CardLanguageFilter, signal: AbortSignal) {
  const cached = getCachedClientSets(language);

  if (cached?.length) {
    return cached;
  }

  const response = await fetch(`/api/search-sets?lang=${encodeURIComponent(language)}`, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`Set warmup failed for ${language}`);
  }

  const payload = (await response.json()) as { sets?: TcgSet[] };
  return warmClientSetsCache(language, uniqueSetsById(payload.sets ?? []));
}

async function fetchClientSearch(
  {
    query = "",
    setFilter = "",
    page = 1,
    language = "all",
    sort = "price-desc",
  }: {
    query?: string;
    setFilter?: string;
    page?: number;
    language?: CardLanguageFilter;
    sort?: "price-desc";
  },
  signal: AbortSignal,
) {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set("q", query.trim());
  }

  if (setFilter.trim()) {
    params.set("set", setFilter.trim());
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  if (language !== "all") {
    params.set("lang", language);
  }

  if (sort !== "price-desc") {
    params.set("sort", sort);
  }

  const response = await fetch(`/api/live-search?${params.toString()}`, { signal });

  if (!response.ok) {
    throw new Error("Search warmup failed");
  }

  const payload = (await response.json()) as LiveSearchResponse;
  warmClientSearchCache(
    makeClientSearchCacheKey({ query, setFilter, page, language, sort }),
    payload,
  );

  return payload;
}

function collectCardSlugs(responses: Array<LiveSearchResponse | null | undefined>) {
  return [
    ...new Set(
      responses
        .flatMap((response) => response?.results ?? [])
        .map((result) => result.card.slug)
        .filter(Boolean),
    ),
  ];
}

export type CatalogWarmupProgress = {
  phase: "sets" | "searches" | "routes" | "done";
  detail: string;
};

export async function runBackgroundCatalogWarmup({
  signal,
  prefetchRoute,
  onProgress,
}: {
  signal: AbortSignal;
  prefetchRoute: (href: string) => void;
  onProgress?: (progress: CatalogWarmupProgress) => void;
}) {
  onProgress?.({ phase: "sets", detail: "Caching English and Japanese sets..." });

  const setsByLanguage: Partial<Record<CardLanguageFilter, TcgSet[]>> = {};

  for (const language of WARM_LANGUAGES) {
    if (signal.aborted) {
      return;
    }

    try {
      setsByLanguage[language] = await fetchClientSets(language, signal);
    } catch {
      // Continue warming whatever is available.
    }
  }

  onProgress?.({ phase: "searches", detail: "Prefetching trending and set catalogs..." });

  const trendingResponses = await Promise.all(
    WARM_LANGUAGES.map((language) =>
      fetchClientSearch({ language, sort: "price-desc" }, signal).catch(() => null),
    ),
  );

  const setBrowseJobs: Array<{ language: CardLanguageFilter; setId: string }> = [];

  for (const language of ["en", "ja", "ko", "zh-cn"] as const) {
    const sets = setsByLanguage[language] ?? [];

    for (const set of sets.slice(0, SET_BROWSE_WARMUP_PER_LANGUAGE)) {
      setBrowseJobs.push({ language, setId: set.id });
    }
  }

  await mapWithConcurrency(setBrowseJobs, SEARCH_CONCURRENCY, async ({ language, setId }) => {
    if (signal.aborted) {
      return;
    }

    await fetchClientSearch({ setFilter: setId, language, sort: "price-desc" }, signal).catch(
      () => undefined,
    );
    await delay(40);
  });

  onProgress?.({ phase: "routes", detail: "Prefetching card detail pages..." });

  const searchRoutes = [
    "/search",
    "/search?sort=price-desc",
    "/search?lang=en&sort=price-desc",
    "/search?lang=ja&sort=price-desc",
    ...setBrowseJobs.map(
      ({ language, setId }) =>
        `/search?set=${encodeURIComponent(setId)}&lang=${language}&sort=price-desc`,
    ),
  ];

  for (const href of searchRoutes) {
    if (signal.aborted) {
      return;
    }

    prefetchRoute(href);
  }

  const slugs = collectCardSlugs(trendingResponses).slice(0, 24);

  const saveData =
    typeof navigator !== "undefined" &&
    "connection" in navigator &&
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

  for (const slug of slugs) {
    if (signal.aborted) {
      return;
    }

    if (!saveData) {
      await warmClientCardCacheFromApi(slug, signal);
    }

    prefetchRoute(`/cards/${slug}`);
    await delay(saveData ? 80 : 25);
  }

  onProgress?.({ phase: "done", detail: "Catalog ready" });
}
