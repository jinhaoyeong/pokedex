"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import { LazyScanButton } from "@/components/search/lazy-scan-button";
import { SearchSelect } from "@/components/search/search-select";
import { useSearchNavigation } from "@/components/search/search-navigation";
import {
  getCachedClientSets,
  prefetchClientSearch,
  uniqueSetsById,
  warmClientSetsCache,
} from "@/lib/client-catalog-cache";
import { resolveHydrationSafeSets } from "@/lib/hydration-safe-sets";
import { formatSetFilterOptionLabel } from "@/lib/set-display-sort";
import { canonicalJapaneseSetFilterValue } from "@/lib/japanese-set-filter";
import {
  CARD_EDITION_FILTERS,
  DEFAULT_EDITION_FILTER,
  DEFAULT_SEARCH_SORT,
} from "@/lib/search-constants";
import { readSettings } from "@/lib/settings-store";
import type {
  CardEditionFilter,
  CardLanguageFilter,
  SearchSortOption,
  TcgSet,
} from "@/types/pokemon";

type LanguageOption = {
  code: CardLanguageFilter;
  label: string;
};

const SORT_OPTIONS: Array<{ value: SearchSortOption; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "change-desc", label: "Change: high to low" },
  { value: "change-asc", label: "Change: low to high" },
  { value: "number-desc", label: "Number: high to low" },
  { value: "number-asc", label: "Number: low to high" },
];

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
  edition,
}: {
  language: CardLanguageFilter;
  query: string;
  setFilter: string;
  sort: SearchSortOption;
  edition: CardEditionFilter;
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

  if (edition !== DEFAULT_EDITION_FILTER) {
    params.set("edition", edition);
  }

  const queryString = params.toString();
  return queryString ? `/search?${queryString}` : "/search";
}

// The set list cannot be known during SSR: the `sets` state initialiser reads
// getCachedClientSets(), so the server always starts from an empty list while a
// returning visitor's client starts from a warm cache. Rendering that cache
// straight into the markup made the two disagree on the very first paint
// ("0 sets ready" vs "524 sets ready", or "Loading sets..." vs "All sets",
// plus a disabled vs enabled trigger) — a hydration mismatch that only showed
// up once the cache had something in it.
//
// useSyncExternalStore is the right instrument rather than a useEffect flag: it
// reports false to both the server render AND the hydrating client render, then
// flips to true afterwards, so the two passes are identical by construction.
// Until then, render the server snapshot for both the count and the set filter.
function subscribeMounted() {
  return () => undefined;
}

function getMounted() {
  return true;
}

function getServerMounted() {
  return false;
}

let filtersOpenPreference: boolean | null = null;

export function SearchForm({
  initialLanguage,
  initialQuery,
  initialSetFilter,
  initialSort,
  initialEdition,
  initialSets,
  languageOptions,
}: {
  initialLanguage: CardLanguageFilter;
  initialQuery: string;
  initialSetFilter: string;
  initialSort: SearchSortOption;
  initialEdition: CardEditionFilter;
  initialSets: TcgSet[];
  languageOptions: LanguageOption[];
}) {
  const router = useRouter();
  const { beginSearchNavigation, isSearchPending } = useSearchNavigation();
  const [query, setQuery] = useState(initialQuery);
  const [language, setLanguage] = useState<CardLanguageFilter>(initialLanguage);
  const [setFilter, setSetFilter] = useState(initialSetFilter);
  const [sort, setSort] = useState<SearchSortOption>(initialSort);
  const [edition, setEdition] = useState<CardEditionFilter>(initialEdition);
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
  const [filtersOpen, setFiltersOpen] = useState(() => {
    const openedByUrl =
      Boolean(initialSetFilter) ||
      initialLanguage !== "all" ||
      initialEdition !== DEFAULT_EDITION_FILTER ||
      initialSort !== DEFAULT_SEARCH_SORT;

    if (typeof window === "undefined" || filtersOpenPreference === null) {
      return openedByUrl;
    }

    return filtersOpenPreference;
  });
  const mounted = useSyncExternalStore(subscribeMounted, getMounted, getServerMounted);
  const { sets: visibleSets, isLoadingSets: visibleLoadingSets } =
    resolveHydrationSafeSets({
      mounted,
      clientSets: sets,
      initialSets: uniqueSetsById(initialSets),
      isLoadingSets,
    });
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
        label: visibleLoadingSets ? "Loading sets" : baseLabel,
      },
      ...uniqueSetsById(visibleSets).map((set) => ({
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
  }, [visibleLoadingSets, language, languageOptions, setFilter, visibleSets]);

  const pushSearch = (
    nextSetFilter = setFilter,
    nextLanguage = language,
    nextSort = sort,
    immediate = false,
    nextEdition = edition,
  ) => {
    prefetchClientSearch({
      query,
      setFilter: nextSetFilter,
      page: 1,
      language: nextLanguage,
      sort: nextSort,
      edition: nextEdition,
    });
    beginSearchNavigation();

    const navigate = () => {
      startTransition(() => {
        router.push(
          buildSearchUrl({
            language: nextLanguage,
            query,
            setFilter: nextSetFilter,
            sort: nextSort,
            edition: nextEdition,
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

  // Four filters are how you narrow an answer, not how you ask one, so they
  // fold away behind a toggle that reports how many are on — and, while folded,
  // names them, so a narrowed result never looks like the whole catalog.
  // Data only. Clearing goes through one handler keyed by name rather than a
  // closure per chip: pushSearch touches a timer ref, and building an array of
  // closures over it during render is exactly what react-hooks/refs is for.
  const clearFilter = (key: string) => {
    if (key === "set") {
      setSetFilter("");
      pushSearch("", language, sort, true);
    } else if (key === "lang") {
      setLanguage("all");
      setSetFilter("");
      setIsLoadingSets(true);
      setSetLoadFailed(false);
      pushSearch("", "all", sort, true);
    } else if (key === "edition") {
      setEdition(DEFAULT_EDITION_FILTER);
      pushSearch(setFilter, language, sort, true, DEFAULT_EDITION_FILTER);
    } else if (key === "sort") {
      setSort(DEFAULT_SEARCH_SORT);
      pushSearch(setFilter, language, DEFAULT_SEARCH_SORT, true);
    }
  };

  const filterChips: Array<{ key: string; label: string }> = [];

  if (setFilter) {
    filterChips.push({
      key: "set",
      label:
        setOptions.find((option) => option.value === setFilter)?.label ??
        setFilter.toUpperCase(),
    });
  }

  if (language !== "all") {
    filterChips.push({ key: "lang", label: languageLabel(languageOptions, language) });
  }

  if (edition !== DEFAULT_EDITION_FILTER) {
    filterChips.push({
      key: "edition",
      label: CARD_EDITION_FILTERS.find((item) => item.value === edition)?.label ?? edition,
    });
  }

  if (sort !== DEFAULT_SEARCH_SORT) {
    filterChips.push({
      key: "sort",
      label: SORT_OPTIONS.find((item) => item.value === sort)?.label ?? sort,
    });
  }

  const activeFilterCount = filterChips.length;

  return (
    <div className="dex-search">
      <form
        className="search-form dex-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          const settings = readSettings();
          const nextLanguage =
            language !== "all" ? language : settings.defaultSearchLanguage;
          const nextSort =
            sort !== DEFAULT_SEARCH_SORT ? sort : settings.defaultSearchSort;
          if (nextLanguage !== language) {
            setLanguage(nextLanguage);
          }
          if (nextSort !== sort) {
            setSort(nextSort);
          }
          pushSearch(setFilter, nextLanguage, nextSort, true);
        }}
      >
        <div className="dex-search-field">
          <svg
            className="dex-search-icon"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <circle cx="8.75" cy="8.75" r="5.25" />
            <path d="M12.7 12.7 16.5 16.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search cards, sets or numbers"
            className="form-input dex-search-input min-w-0"
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary dex-search-submit disabled:cursor-wait disabled:opacity-70"
          disabled={isPending || isSearchPending}
        >
          {isPending || isSearchPending ? "Loading" : "Search"}
        </button>
      </form>

      <div className="dex-search-tools">
        <button
          type="button"
          className="dex-filter-toggle"
          aria-expanded={filtersOpen}
          aria-controls="dex-search-filters"
          onClick={() =>
            setFiltersOpen((open) => {
              filtersOpenPreference = !open;
              return !open;
            })
          }
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
            className="dex-filter-glyph"
          >
            <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
            <circle cx="7.5" cy="6" r="1.9" fill="currentColor" stroke="none" />
            <circle cx="13" cy="10" r="1.9" fill="currentColor" stroke="none" />
            <circle cx="6" cy="14" r="1.9" fill="currentColor" stroke="none" />
          </svg>
          Filters
          {activeFilterCount ? (
            <span className="dex-filter-count">{activeFilterCount}</span>
          ) : null}
          <span className="dex-filter-caret" aria-hidden />
        </button>
        <LazyScanButton />
      </div>

      {!filtersOpen && filterChips.length ? (
        <div className="dex-filter-chips">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="dex-filter-chip"
              aria-label={`Clear filter: ${chip.label}`}
              onClick={() => clearFilter(chip.key)}
            >
              <span className="dex-filter-chip-label">{chip.label}</span>
              <span className="dex-filter-chip-clear" aria-hidden>
                &times;
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="dex-search-drawer" data-open={filtersOpen || undefined}>
      <div id="dex-search-filters" className="dex-search-filters">
        <SearchSelect
          name="set"
          ariaLabel="Filter by set"
          value={setFilter}
          options={setOptions}
          disabled={visibleLoadingSets && !visibleSets.length}
          onChange={(nextSetFilter) => {
            setSetFilter(nextSetFilter);
            pushSearch(nextSetFilter, language, sort, true);
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
            pushSearch(nextSetFilter, typedLanguage, sort, true);
          }}
        />
        <SearchSelect
          name="edition"
          ariaLabel="Filter by edition"
          value={edition}
          options={CARD_EDITION_FILTERS.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          onChange={(nextEdition) => {
            const typed = nextEdition as CardEditionFilter;
            setEdition(typed);
            pushSearch(setFilter, language, sort, true, typed);
          }}
        />
        <SearchSelect
          name="sort"
          ariaLabel="Sort results"
          value={sort}
          options={SORT_OPTIONS}
          onChange={(nextSort) => {
            const typedSort = nextSort as SearchSortOption;
            setSort(typedSort);
            pushSearch(setFilter, language, typedSort, true);
          }}
        />
      </div>
      </div>
    </div>
  );
}
