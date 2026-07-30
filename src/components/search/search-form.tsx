"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { LazyScanButton } from "@/components/search/lazy-scan-button";
import { SearchSelect } from "@/components/search/search-select";
import {
  getCachedClientSets,
  prefetchClientSearch,
  uniqueSetsById,
  warmClientSetsCache,
} from "@/lib/client-catalog-cache";
import { formatSetFilterOptionLabel } from "@/lib/set-display-sort";
import { canonicalJapaneseSetFilterValue } from "@/lib/japanese-set-filter";
import type { CardLanguageFilter, SearchSortOption, TcgSet } from "@/types/pokemon";

type LanguageOption = {
  code: CardLanguageFilter;
  label: string;
};

const SORT_OPTIONS: Array<{ value: SearchSortOption; label: string }> = [
  { value: "relevance", label: "Sort: relevant" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "change-desc", label: "Price change: high to low" },
  { value: "change-asc", label: "Price change: low to high" },
  { value: "number-desc", label: "Card number: high to low" },
  { value: "number-asc", label: "Card number: low to high" },
];

const QUICK_SEARCHES = ["Pikachu", "Base Set", "4/102"] as const;

function languageLabel(languageOptions: LanguageOption[], language: CardLanguageFilter) {
  return languageOptions.find((item) => item.code === language)?.label ?? "Selected";
}

function setOptionLabel(set: TcgSet) {
  return formatSetFilterOptionLabel(set);
}

async function fetchClientSets(
  language: CardLanguageFilter,
  signal: AbortSignal,
  attempt = 0,
): Promise<TcgSet[]> {
  const cached = getCachedClientSets(language);

  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({ lang: language });

  try {
    const response = await fetch(`/api/search-sets?${params.toString()}`, {
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Set list request failed (${response.status})`);
    }

    const payload = (await response.json()) as { sets?: TcgSet[] };
    const sets = uniqueSetsById(payload.sets ?? []);

    if (!sets.length) {
      throw new Error("Set list request returned no sets");
    }

    return warmClientSetsCache(language, sets);
  } catch (error) {
    if (!signal.aborted && attempt < 1) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 350);
      });
      return fetchClientSets(language, signal, attempt + 1);
    }

    throw error;
  }
}

function buildSearchUrl({
  language,
  query,
  setFilter,
  sort,
}: {
  language: CardLanguageFilter;
  query: string;
  setFilter: string;
  sort: SearchSortOption;
}) {
  const params = new URLSearchParams();
  const cleanQuery = query.trim();

  if (cleanQuery) {
    params.set("q", cleanQuery);
  }

  if (setFilter) {
    params.set("set", setFilter);
  }

  if (language !== "all") {
    params.set("lang", language);
  }

  if (sort !== "relevance") {
    params.set("sort", sort);
  }

  const queryString = params.toString();
  return queryString ? `/search?${queryString}` : "/search";
}

export function SearchForm({
  initialLanguage,
  initialQuery,
  initialSetFilter,
  initialSort,
  initialSets,
  languageOptions,
  resultPage,
}: {
  initialLanguage: CardLanguageFilter;
  initialQuery: string;
  initialSetFilter: string;
  initialSort: SearchSortOption;
  initialSets: TcgSet[];
  languageOptions: LanguageOption[];
  resultPage: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [language, setLanguage] = useState<CardLanguageFilter>(initialLanguage);
  const [setFilter, setSetFilter] = useState(initialSetFilter);
  const [sort, setSort] = useState<SearchSortOption>(initialSort);
  const [sets, setSets] = useState<TcgSet[]>(() => {
    const cached = getCachedClientSets(initialLanguage);
    const normalized = uniqueSetsById(
      cached?.length ? cached : initialSets,
    );

    if (normalized.length > 0) {
      warmClientSetsCache(initialLanguage, normalized);
    }

    return normalized;
  });
  const [isLoadingSets, setIsLoadingSets] = useState(
    () => uniqueSetsById(initialSets).length === 0 && !getCachedClientSets(initialLanguage)?.length,
  );
  const [setLoadFailed, setSetLoadFailed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(
    () => Boolean(initialSetFilter || initialLanguage !== "all" || initialSort !== "relevance"),
  );
  const [isPending, startTransition] = useTransition();
  const latestSetRequest = useRef(0);
  const filterNavigateTimer = useRef<number | null>(null);
  const initialSetsRef = useRef(initialSets);

  useEffect(() => {
    initialSetsRef.current = initialSets;

    if (initialSets.length > 0) {
      warmClientSetsCache(language, initialSets);
    }

    const requestId = latestSetRequest.current + 1;
    latestSetRequest.current = requestId;
    const controller = new AbortController();
    let isActive = true;
    const hasServerSets = uniqueSetsById(initialSetsRef.current).length > 0;

    void fetchClientSets(language, controller.signal)
      .then((nextSets) => {
        if (!isActive || latestSetRequest.current !== requestId) {
          return;
        }

        setSets(nextSets);
        setIsLoadingSets(false);
        setSetLoadFailed(false);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          !isActive ||
          latestSetRequest.current !== requestId
        ) {
          return;
        }

        if (hasServerSets) {
          setIsLoadingSets(false);
          setSetLoadFailed(false);
          return;
        }

        console.error(error);
        setIsLoadingSets(false);

        let resolvedCount = 0;
        setSets((currentSets) => {
          const cachedSets = getCachedClientSets(language);
          const fallbackSets =
            currentSets.length > 0
              ? currentSets
              : cachedSets?.length
                ? cachedSets
                : uniqueSetsById(initialSetsRef.current);

          resolvedCount = fallbackSets.length;

          if (fallbackSets.length > 0) {
            warmClientSetsCache(language, fallbackSets);
          }

          return fallbackSets;
        });
        setSetLoadFailed(resolvedCount === 0);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [initialSets, language]);

  const setOptions = useMemo(() => {
    const baseLabel =
      language === "all"
        ? "All sets"
        : `All ${languageLabel(languageOptions, language)} sets`;
    const options = [
      {
        value: "",
        label: isLoadingSets ? "Loading sets..." : baseLabel,
      },
      ...uniqueSetsById(sets).map((set) => ({
        value: canonicalJapaneseSetFilterValue(set),
        label: setOptionLabel(set),
      })),
    ];

    if (setFilter && !options.some((option) => option.value === setFilter)) {
      options.push({
        value: setFilter,
        label: `Selected set (${setFilter.toUpperCase()})`,
      });
    }

    return options;
  }, [isLoadingSets, language, languageOptions, setFilter, sets]);

  const pushSearch = (
    nextSetFilter = setFilter,
    nextLanguage = language,
    nextSort = sort,
    immediate = false,
    nextQuery = query,
  ) => {
    prefetchClientSearch({
      query: nextQuery,
      setFilter: nextSetFilter,
      page: 1,
      language: nextLanguage,
      sort: nextSort,
    });

    const navigate = () => {
      startTransition(() => {
        router.push(
          buildSearchUrl({
            language: nextLanguage,
            query: nextQuery,
            setFilter: nextSetFilter,
            sort: nextSort,
          }),
        );
      });
    };

    if (immediate) {
      if (filterNavigateTimer.current !== null) {
        window.clearTimeout(filterNavigateTimer.current);
        filterNavigateTimer.current = null;
      }
      navigate();
      return;
    }

    if (filterNavigateTimer.current !== null) {
      window.clearTimeout(filterNavigateTimer.current);
    }

    filterNavigateTimer.current = window.setTimeout(() => {
      filterNavigateTimer.current = null;
      navigate();
    }, 120);
  };

  useEffect(() => {
    return () => {
      if (filterNavigateTimer.current !== null) {
        window.clearTimeout(filterNavigateTimer.current);
      }
    };
  }, []);

  const activeFilterCount =
    Number(Boolean(setFilter)) + Number(language !== "all") + Number(sort !== "relevance");
  const hasActiveFilters = activeFilterCount > 0;
  const setStatusCopy =
    setLoadFailed && sets.length === 0
      ? "Set list unavailable."
      : language === "all"
        ? `${sets.length.toLocaleString()} sets ready.`
        : isLoadingSets
          ? `${languageLabel(languageOptions, language)} sets loading.`
          : `${sets.length.toLocaleString()} sets ready.`;

  return (
    <section className="search-panel glass-card rounded-3xl p-4 sm:p-5">
      <form
        className={`search-form surface-original-only grid gap-3 sm:gap-3.5 ${
          language === "all" || setOptions.length
            ? "xl:grid-cols-[minmax(17rem,1.25fr)_minmax(15rem,1fr)_minmax(13rem,0.85fr)_minmax(13rem,0.85fr)_auto]"
            : "lg:grid-cols-[minmax(20rem,1.5fr)_minmax(14rem,0.9fr)_minmax(13rem,0.85fr)_auto]"
        }`}
        onSubmit={(event) => {
          event.preventDefault();
          pushSearch(setFilter, language, sort, true);
        }}
      >
        <input
          type="text"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            language === "en"
              ? "Try Charizard, 203, Base Set, or Umbreon ex"
              : language === "all"
                ? "Try English names: Charizard, Pikachu - also 203, MEW, or Japanese text"
                : "Try Pikachu, local card number, or the card name in the selected language"
          }
          className="form-input min-w-0 sm:px-5 sm:py-3.5"
        />
        <SearchSelect
          name="set"
          ariaLabel="Filter by set"
          value={setFilter}
          options={setOptions}
          disabled={isLoadingSets && !sets.length}
          onChange={(nextSetFilter) => {
            setSetFilter(nextSetFilter);
            pushSearch(nextSetFilter);
          }}
        />
        <SearchSelect
          name="lang"
          ariaLabel="Filter by language"
          value={language}
          options={languageOptions.map((item) => ({
            value: item.code,
            label: item.label,
          }))}
          onChange={(nextLanguage) => {
            const typedLanguage = nextLanguage as CardLanguageFilter;
            const keepJapaneseSet =
              typedLanguage === "ja" &&
              setFilter &&
              sets.some(
                (set) =>
                  set.language === "ja" &&
                  canonicalJapaneseSetFilterValue(set) === setFilter,
              );
            const nextSetFilter = keepJapaneseSet ? setFilter : "";

            setLanguage(typedLanguage);
            setSetFilter(nextSetFilter);
            setIsLoadingSets(true);
            setSetLoadFailed(false);
            pushSearch(nextSetFilter, typedLanguage, sort);
          }}
        />
        <SearchSelect
          name="sort"
          value={sort}
          options={SORT_OPTIONS}
          onChange={(nextSort) => {
            const typedSort = nextSort as SearchSortOption;
            setSort(typedSort);
            pushSearch(setFilter, language, typedSort);
          }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-block btn-block-xl-auto disabled:cursor-wait disabled:opacity-70"
          disabled={isPending}
        >
          {isPending ? "Loading" : "Search"}
        </button>
      </form>
      <div className="search-panel-meta surface-original-only mt-3 flex items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--line)] pt-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <LazyScanButton />
          <span className="hidden text-xs font-medium text-slate-400 min-[480px]:inline sm:text-sm">
            Have the card in hand? Snap a photo and we&apos;ll find it.
          </span>
        </div>
        <p className="shrink-0 text-right text-[0.7rem] leading-5 text-slate-400 sm:text-sm">
          {setLoadFailed && sets.length === 0
            ? "Set list unavailable. "
            : language === "all"
              ? `${sets.length.toLocaleString()} sets ready. `
              : isLoadingSets
                ? `${languageLabel(languageOptions, language)} sets loading. `
                : `${sets.length.toLocaleString()} sets ready. `}
          {`Showing page ${resultPage}.`}
        </p>
      </div>

      <form
        className="search-form-refined surface-improved-only"
        onSubmit={(event) => {
          event.preventDefault();
          pushSearch(setFilter, language, sort, true);
        }}
      >
        <div className="search-query-group">
          <label htmlFor="dex-search-query">Card, set, or collector number</label>
          <div className="search-query-row">
            <input
              id="dex-search-query"
              type="text"
              name="q"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                language === "en"
                  ? "Try Charizard, Base Set, or 4/102"
                  : language === "all"
                    ? "Try Pikachu, MEW 203, or a Japanese card name"
                    : "Try a card name or local collector number"
              }
              className="form-input min-w-0"
            />
            <button
              type="submit"
              className="btn btn-primary search-submit-button disabled:cursor-wait disabled:opacity-70"
              disabled={isPending}
            >
              {isPending ? "Searching…" : "Search cards"}
            </button>
          </div>
          <div className="search-query-help">
            <LazyScanButton />
            <span>Have the card in hand? Scan the front instead.</span>
          </div>
          <div className="dex-quick-searches" aria-label="Example searches">
            <span>Try</span>
            {QUICK_SEARCHES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuery(example);
                  pushSearch(setFilter, language, sort, true, example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        <div className="search-filter-bar">
          <div className="search-filter-desktop-label" aria-hidden="true">
            <span>Refine results</span>
            {activeFilterCount ? <span>{activeFilterCount} active</span> : <span>Optional</span>}
          </div>
          <button
            type="button"
            className="search-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="dex-search-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <span>Filters</span>
            {activeFilterCount ? (
              <span className="search-filter-count">{activeFilterCount}</span>
            ) : (
              <span className="search-filter-optional">Optional</span>
            )}
            <span className="search-filter-chevron" aria-hidden="true" />
          </button>
          <div className="search-filter-status">
            <p aria-live="polite">
              {setStatusCopy} Page {resultPage}.
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={() => {
                  setSetFilter("");
                  setLanguage("all");
                  setSort("relevance");
                  if (language !== "all") {
                    setIsLoadingSets(true);
                  }
                  setSetLoadFailed(false);
                  pushSearch("", "all", "relevance", true);
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        <div
          id="dex-search-filters"
          className="search-filter-fields"
          data-open={filtersOpen ? "true" : "false"}
        >
          <div className="search-filter-field">
            <span id="dex-set-label">Set</span>
            <SearchSelect
              name="set"
              labelledBy="dex-set-label"
              value={setFilter}
              options={setOptions}
              disabled={isLoadingSets && !sets.length}
              onChange={(nextSetFilter) => {
                setSetFilter(nextSetFilter);
                pushSearch(nextSetFilter);
              }}
            />
          </div>
          <div className="search-filter-field">
            <span id="dex-language-label">Language</span>
            <SearchSelect
              name="lang"
              labelledBy="dex-language-label"
              value={language}
              options={languageOptions.map((item) => ({
                value: item.code,
                label: item.label,
              }))}
              onChange={(nextLanguage) => {
                const typedLanguage = nextLanguage as CardLanguageFilter;
                const keepJapaneseSet =
                  typedLanguage === "ja" &&
                  setFilter &&
                  sets.some(
                    (set) =>
                      set.language === "ja" &&
                      canonicalJapaneseSetFilterValue(set) === setFilter,
                  );
                const nextSetFilter = keepJapaneseSet ? setFilter : "";

                setLanguage(typedLanguage);
                setSetFilter(nextSetFilter);
                setIsLoadingSets(true);
                setSetLoadFailed(false);
                pushSearch(nextSetFilter, typedLanguage, sort);
              }}
            />
          </div>
          <div className="search-filter-field">
            <span id="dex-sort-label">Sort results</span>
            <SearchSelect
              name="sort"
              labelledBy="dex-sort-label"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(nextSort) => {
                const typedSort = nextSort as SearchSortOption;
                setSort(typedSort);
                pushSearch(setFilter, language, typedSort);
              }}
            />
          </div>
        </div>
      </form>
    </section>
  );
}
