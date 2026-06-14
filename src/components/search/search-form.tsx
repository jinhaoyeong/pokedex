"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
  ) => {
    prefetchClientSearch({
      query,
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
            query,
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

  return (
    <section className="search-panel glass-card rounded-3xl p-5 sm:p-7">
      <form
        className={`search-form grid gap-4 sm:gap-5 ${
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
          className="min-w-0 rounded-2xl border border-yellow-200/20 bg-[#050816] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-yellow-300/70 sm:px-5 sm:py-3.5"
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
          className="trainer-button w-full rounded-2xl bg-blue-500 px-6 py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-70 sm:py-3.5 xl:w-auto"
          disabled={isPending}
        >
          {isPending ? "Loading" : "Search"}
        </button>
      </form>
      <p className="mt-5 text-xs leading-5 text-slate-400 sm:text-sm">
        {setLoadFailed && sets.length === 0
          ? "Set list unavailable. "
          : language === "all"
            ? `${sets.length.toLocaleString()} sets ready. `
            : isLoadingSets
              ? `${languageLabel(languageOptions, language)} sets loading. `
              : `${sets.length.toLocaleString()} sets ready. `}
        {`Showing page ${resultPage}.`}
      </p>
    </section>
  );
}
