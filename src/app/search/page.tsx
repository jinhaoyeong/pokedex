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
} from "@/components/search/search-results-section";
import { getStaticMarketPool, getStaticTrendingSearchResponse } from "@/lib/preview-cards";
import { CARD_LANGUAGE_FILTERS } from "@/lib/search-constants";

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
  const instantTrending =
    !query.trim() &&
    !setFilter &&
    page === 1 &&
    (language === "all" || language === "en")
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
    <main className="app-main search-page-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <Suspense fallback={null}>
        <SearchDefaultsApplier />
      </Suspense>
      <DexHero cards={scannerCards}>
        <h1 className="dex-hero-title">Find cards by name, set, or number</h1>
        <p className="dex-hero-sub">
          One index across English, Japanese and Chinese sets. Match on a card
          name, a set code, or the collector number printed at its edge.
        </p>
      </DexHero>

      <SearchNavigationProvider navigationKey={resultsKey}>
      <SearchForm
        key={`${language}:${setFilter}:${query}:${sort}:${edition}`}
        initialLanguage={language}
        initialQuery={query}
        initialSetFilter={setFilter}
        initialSort={sort}
        initialEdition={edition}
        initialSets={[]}
        languageOptions={CARD_LANGUAGE_FILTERS}
        resultPage={page}
      />

      <SearchResultsPendingGate fallback={resultsFallback}>
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
      </SearchResultsPendingGate>
      </SearchNavigationProvider>
    </main>
  );
}
