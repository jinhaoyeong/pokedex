import type { Metadata } from "next";
import { Suspense } from "react";

import { DesignComparisonDock } from "@/components/design-comparison-dock";
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
import type { CardLanguageFilter, TcgSet } from "@/types/pokemon";

export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Card Dex",
};

const dexChanges = [
  "The oversized hero is replaced by a compact Dex command header.",
  "Search, scan, examples, and filters now read as one workflow.",
  "Desktop filters stay visible while mobile keeps progressive disclosure.",
  "Active search context stays attached to the result count.",
  "Cards browse in a dense identity-first grid instead of oversized rows.",
] as const;

function loadInitialSets(language: CardLanguageFilter) {
  return new Promise<TcgSet[]>((resolve) => {
    const timeout = setTimeout(() => resolve([]), 1800);

    void fetchSearchSets(language)
      .then((sets) => {
        clearTimeout(timeout);
        resolve(sets);
      })
      .catch(() => {
        clearTimeout(timeout);
        resolve([]);
      });
  });
}

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
  // Do not hold the whole Dex behind a slow catalog provider. The client-side
  // set loader keeps warming after the task-first search surface is visible.
  const initialSets = await loadInitialSets(language);
  // Bundled static pool only — the hero must never wait on a live search.
  const scannerCards = getStaticMarketPool().slice(0, 4);

  return (
    <main className="app-main search-page-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <Suspense fallback={null}>
        <SearchDefaultsApplier />
      </Suspense>
      <section className="search-hero surface-original-only relative overflow-hidden px-4 py-3 sm:px-8 sm:py-5 lg:px-10 lg:py-6">
        <div className="pixel-cloud left-4 top-3 sm:left-5 sm:top-5" aria-hidden="true" />
        <div className="pixel-cloud pixel-cloud-small bottom-3 right-6 sm:bottom-5 sm:right-10" aria-hidden="true" />
        <div className="absolute -right-10 -top-10 hidden h-28 w-28 rounded-full border-[12px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:block sm:-right-8 sm:-top-8 sm:h-32 sm:w-32 sm:border-[14px] sm:opacity-35" />
        <div className="relative grid gap-3 sm:gap-5 lg:grid-cols-[1fr_16rem] lg:items-center">
          <div className="carddex-hero-copy space-y-1.5 sm:space-y-2.5 lg:space-y-3">
            <span className="premium-kicker surface-original-only">
              Card Dex scanner
            </span>
            <h1 className="section-title pokemon-display-title carddex-hero-title surface-original-only max-w-4xl text-[1.25rem] leading-tight sm:text-[2.35rem] sm:leading-none">
              Find cards by name, set, or number
            </h1>
            <p className="hero-subline surface-original-only max-w-2xl text-[0.88rem] sm:text-[0.98rem]">
              Search by name, set, language, or collector number.
            </p>
          </div>
          {/* Scanner is desktop-only — on phones it ate the first screen and buried search. */}
          <div className="surface-original-only hidden justify-self-end lg:block">
            <DexHeroScanner cards={scannerCards} />
          </div>
        </div>
      </section>

      <section className="dex-command-header surface-improved-only" aria-labelledby="dex-page-title">
        <div>
          <span className="premium-kicker">Card Dex</span>
          <h1 id="dex-page-title">Find the right card.</h1>
        </div>
        <p>
          Search by name, set, or collector number. Add filters when the printing matters.
        </p>
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
      <DesignComparisonDock surface="Card Dex" changes={dexChanges} />
    </main>
  );
}
