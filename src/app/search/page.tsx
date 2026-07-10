import type { Metadata } from "next";
import { Suspense } from "react";

import { DexHeroScanner } from "@/components/search/dex-hero-scanner";
import { SearchDefaultsApplier } from "@/components/search/search-defaults-applier";
import { SearchForm } from "@/components/search/search-form";
import {
  parseSearchPageParams,
  SearchResultsSection,
} from "@/components/search/search-results-section";
import { SearchResultsBootFallback } from "@/components/search/search-results-boot-fallback";
import { fetchSearchSets } from "@/lib/pokemon-tcg-api";
import { getStaticMarketPool } from "@/lib/preview-cards";
import { CARD_LANGUAGE_FILTERS } from "@/lib/search-constants";

export const maxDuration = 60;

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
  }>;
}) {
  const params = await searchParams;
  const { query, setFilter, page, language, sort } = parseSearchPageParams(params);
  const resultsKey = `${language}:${setFilter}:${query}:${sort}:${page}`;
  const initialSets = await fetchSearchSets(language).catch(() => []);
  // Bundled static pool only — the hero must never wait on a live search.
  const scannerCards = getStaticMarketPool().slice(0, 4);

  return (
    <main className="app-main search-page-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <Suspense fallback={null}>
        <SearchDefaultsApplier />
      </Suspense>
      <section className="search-hero relative overflow-hidden px-4 py-4 sm:px-8 sm:py-5 lg:px-10 lg:py-6">
        <div className="pixel-cloud left-4 top-4 sm:left-5 sm:top-5" aria-hidden="true" />
        <div className="pixel-cloud pixel-cloud-small bottom-4 right-6 sm:bottom-5 sm:right-10" aria-hidden="true" />
        <div className="absolute -right-10 -top-10 hidden h-28 w-28 rounded-full border-[12px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:block sm:-right-8 sm:-top-8 sm:h-32 sm:w-32 sm:border-[14px] sm:opacity-35" />
        <div className="relative grid gap-4 sm:gap-5 lg:grid-cols-[1fr_16rem] lg:items-center">
          <div className="carddex-hero-copy space-y-2 sm:space-y-2.5 lg:space-y-3">
            <span className="premium-kicker">
              Card Dex scanner
            </span>
            <h1 className="section-title pokemon-display-title carddex-hero-title max-w-4xl text-[1.35rem] sm:text-[2.35rem]">
              Find cards by name, set, or number
            </h1>
            <p className="hero-subline max-w-2xl">
              Search by name, set, language, or collector number.
            </p>
          </div>
          <div className="mx-auto w-full max-w-[15rem] justify-self-center sm:max-w-[16rem] lg:mx-0 lg:justify-self-end">
            <DexHeroScanner cards={scannerCards} />
          </div>
        </div>
      </section>

      <SearchForm
        key={`${language}:${setFilter}:${query}:${sort}`}
        initialLanguage={language}
        initialQuery={query}
        initialSetFilter={setFilter}
        initialSort={sort}
        initialSets={initialSets}
        languageOptions={CARD_LANGUAGE_FILTERS}
        resultPage={page}
      />

      <Suspense
        key={resultsKey}
        fallback={
          <SearchResultsBootFallback
            query={query}
            setFilter={setFilter}
            page={page}
            language={language}
            sort={sort}
          />
        }
      >
        <SearchResultsSection
          query={query}
          setFilter={setFilter}
          page={page}
          language={language}
          sort={sort}
        />
      </Suspense>
    </main>
  );
}
