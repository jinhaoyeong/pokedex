import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchDefaultsApplier } from "@/components/search/search-defaults-applier";
import { SearchForm } from "@/components/search/search-form";
import {
  parseSearchPageParams,
  SearchResultsSection,
} from "@/components/search/search-results-section";
import { SearchResultsBootFallback } from "@/components/search/search-results-boot-fallback";
import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";
import { CARD_LANGUAGE_FILTERS } from "@/lib/search-constants";

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

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <Suspense fallback={null}>
        <SearchDefaultsApplier />
      </Suspense>
      <section className="search-hero relative overflow-hidden p-5 sm:p-10 lg:p-12">
        <div className="pixel-cloud left-5 top-7" aria-hidden="true" />
        <div className="pixel-cloud pixel-cloud-small bottom-8 right-12" aria-hidden="true" />
        <div className="absolute -right-12 -top-12 hidden h-32 w-32 rounded-full border-[14px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:block sm:-right-10 sm:-top-10 sm:h-36 sm:w-36 sm:border-[18px] sm:opacity-35" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-center">
          <div className="carddex-hero-copy space-y-4 sm:space-y-5">
            <span className="premium-kicker">
              Card Dex scanner
            </span>
            <h1 className="section-title pokemon-display-title carddex-hero-title max-w-4xl text-[1.65rem] sm:text-6xl">
              Find cards by name, set, or number
            </h1>
            <p className="hero-subline max-w-2xl">
              Search by name, set, language, or collector number.
            </p>
          </div>
          <div className="search-scanner-card hidden justify-self-end lg:block" aria-hidden="true">
            <div className="scanner-card-frame">
              <div className="scanner-card-top">
                <span>DEX-01</span>
                <strong>Scan Ready</strong>
              </div>
              <div className="scanner-card-screen">
                <span className="scanner-line" />
                <span className="scanner-card-shape" />
                <span className="scanner-code code-a" />
                <span className="scanner-code code-b" />
                <span className="scanner-code code-c" />
              </div>
              <div className="scanner-card-footer">
                <span>Set</span>
                <span>Lang</span>
                <span>No.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SearchForm
        key={`${language}:${setFilter}:${query}:${sort}`}
        initialLanguage={language}
        initialQuery={query}
        initialSetFilter={setFilter}
        initialSort={sort}
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
