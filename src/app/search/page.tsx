import type { Metadata } from "next";
import { Suspense } from "react";

import { DexHero } from "@/components/search/dex-hero-slab";
import { SearchDefaultsApplier } from "@/components/search/search-defaults-applier";
import { SearchForm } from "@/components/search/search-form";
import {
  SearchNavigationProvider,
  SearchResultsPendingGate,
} from "@/components/search/search-navigation";
import { SearchResultsBootFallback } from "@/components/search/search-results-boot-fallback";
import {
  parseSearchPageParams,
  SearchResultsSection,
  SearchResultsView,
} from "@/components/search/search-results-section";
import { getStaticMarketPool, getStaticTrendingSearchResponse } from "@/lib/preview-cards";
import { CARD_LANGUAGE_FILTERS } from "@/lib/search-constants";
import { shouldCommitStaticDexLanding } from "@/lib/search-landing-fallback";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Search",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    set?: string;
    page?: string;
    lang?: string;
    sort?: string;
    edition?: string;
  }>;
}) {
  const params = await searchParams;
  const { query, setFilter, page, language, sort, edition } = parseSearchPageParams(params);
  const resultsKey = `${language}:${setFilter}:${query}:${sort}:${edition}:${page}`;
  // Bundled static pool only — the hero must never wait on a live search.
  const scannerCards = getStaticMarketPool().slice(0, 4);
  const instantTrending = shouldCommitStaticDexLanding({
    query,
    setFilter,
    page,
    sort,
  })
    ? getStaticTrendingSearchResponse()
    : null;
  const resultsFallback = (
    <SearchResultsBootFallback
      query={query}
      setFilter={setFilter}
      page={page}
      language={language}
      sort={sort}
      edition={edition}
      instantResponse={instantTrending}
    />
  );

  return (
    <main className="app-main search-page-main app-frame flex min-h-screen w-full flex-col">
      <Suspense fallback={null}>
        <SearchDefaultsApplier />
      </Suspense>
      <SearchNavigationProvider navigationKey={resultsKey}>
      <DexHero
        cards={scannerCards}
        search={
          <SearchForm
            key={`${language}:${setFilter}:${query}:${sort}:${edition}`}
            initialLanguage={language}
            initialQuery={query}
            initialSetFilter={setFilter}
            initialSort={sort}
            initialEdition={edition}
            initialSets={[]}
            languageOptions={CARD_LANGUAGE_FILTERS}
          />
        }
      >
        <h1 className="dex-hero-title">
          Find cards by <em>name</em>, <em>set</em>, or <em>number</em>
        </h1>
      </DexHero>

      <SearchResultsPendingGate fallback={resultsFallback}>
      {instantTrending ? (
        <SearchResultsView
          query={query}
          setFilter={setFilter}
          page={page}
          language={language}
          sort={sort}
          edition={edition}
          searchResponse={instantTrending}
        />
      ) : (
        <Suspense
          key={resultsKey}
          fallback={resultsFallback}
        >
          <SearchResultsSection
            query={query}
            setFilter={setFilter}
            page={page}
            language={language}
            sort={sort}
            edition={edition}
          />
        </Suspense>
      )}
      </SearchResultsPendingGate>
      </SearchNavigationProvider>
    </main>
  );
}
