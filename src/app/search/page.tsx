import type { Metadata } from "next";

import { SearchResults } from "@/components/search/search-results";
import { SearchSelect } from "@/components/search/search-select";
import {
  CARD_LANGUAGE_FILTERS,
  fetchSearchSets,
  searchLiveCards,
} from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter } from "@/types/pokemon";

export const metadata: Metadata = {
  title: "Search",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; set?: string; page?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const query = params.q ?? "";
  const setFilter = params.set ?? "";
  const page = Number.parseInt(params.page ?? "1", 10);
  const requestedLanguage = params.lang ?? "all";
  const language = CARD_LANGUAGE_FILTERS.some(
    (item) => item.code === requestedLanguage,
  )
    ? (requestedLanguage as CardLanguageFilter)
    : "all";
  const [searchResponse, sets] = await Promise.all([
    searchLiveCards(query, setFilter, Number.isNaN(page) ? 1 : page, language),
    fetchSearchSets(language),
  ]);
  const totalPages =
    typeof searchResponse.totalCount === "number"
      ? Math.max(1, Math.ceil(searchResponse.totalCount / searchResponse.pageSize))
      : null;

  const buildSearchHref = (nextPage: number) => {
    const nextParams = new URLSearchParams();

    if (query) {
      nextParams.set("q", query);
    }

    if (setFilter) {
      nextParams.set("set", setFilter);
    }

    if (language !== "all") {
      nextParams.set("lang", language);
    }

    if (nextPage > 1) {
      nextParams.set("page", nextPage.toString());
    }

    const queryString = nextParams.toString();
    return queryString ? `/search?${queryString}` : "/search";
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <section className="search-hero relative overflow-hidden rounded-[1.5rem] border border-yellow-200/20 bg-gradient-to-br from-[#142d64] via-[#0b1022] to-[#1d1026] p-4 sm:rounded-[2rem] sm:p-8">
        <div className="pixel-cloud left-5 top-7" aria-hidden="true" />
        <div className="pixel-cloud pixel-cloud-small bottom-8 right-12" aria-hidden="true" />
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full border-[14px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-40 sm:-right-10 sm:-top-10 sm:h-36 sm:w-36 sm:border-[18px] sm:opacity-60" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_14rem] lg:items-center">
          <div className="space-y-3 sm:space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-yellow-300/30 bg-yellow-300/12 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-yellow-100 sm:px-4 sm:text-sm sm:tracking-[0.18em]">
            <span className="energy-spark" />
            Card Dex scanner
          </span>
            <h1 className="section-title max-w-4xl">
              Find the exact card by set, language pack, or collector code.
            </h1>
            <p className="section-copy max-w-3xl">
              Search English, Japanese, Chinese, and other language-specific packs.
              Collector codes use the small fraction on the card (for example 100/095). English and Japanese lists often use different numbers for the same expansion; when catalogs disagree, we may show the closest English sm12 match with a note.
            </p>
          </div>
          <div className="hidden justify-self-end lg:block">
            <div className="pixel-pokemon" aria-hidden="true">
              <span className="pixel-pokemon-ear left" />
              <span className="pixel-pokemon-ear right" />
              <span className="pixel-pokemon-eye left" />
              <span className="pixel-pokemon-eye right" />
              <span className="pixel-pokemon-cheek left" />
              <span className="pixel-pokemon-cheek right" />
              <span className="pixel-pokemon-smile" />
            </div>
          </div>
        </div>
      </section>

      <section className="search-panel glass-card rounded-3xl p-3 sm:p-6">
        <form
          className={`search-form grid gap-4 ${
            language === "all" || sets.length
              ? "xl:grid-cols-[minmax(20rem,1.35fr)_minmax(18rem,1fr)_minmax(14rem,0.9fr)_auto]"
              : "lg:grid-cols-[minmax(20rem,1.5fr)_minmax(14rem,0.9fr)_auto]"
          }`}
        >
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder={
              language === "en"
                ? "Try Charizard, 203, Base Set, or Umbreon ex"
                : language === "all"
                  ? "Try English names: Charizard, Pikachu—also 203, MEW, or Japanese text"
                : "Try Pikachu, local card number, or the card name in the selected language"
            }
            className="min-w-0 rounded-2xl border border-yellow-200/20 bg-[#050816] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-yellow-300/70"
          />
          {language === "all" || sets.length ? (
            <SearchSelect
              name="set"
              value={setFilter}
              options={[
                {
                  value: "",
                  label:
                    language === "all"
                      ? "All sets / all language packs"
                      : `All ${CARD_LANGUAGE_FILTERS.find((item) => item.code === language)?.label} sets`,
                },
                ...sets.map((set) => ({
                  value: set.id,
                  label: `${set.name} (${set.code})`,
                })),
              ]}
            />
          ) : null}
          <SearchSelect
            name="lang"
            value={language}
            options={CARD_LANGUAGE_FILTERS.map((item) => ({
              value: item.code,
              label: item.label,
            }))}
          />
          <button
            type="submit"
            className="trainer-button rounded-2xl bg-blue-500 px-5 py-3 text-sm font-black text-white"
          >
            Search
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-400">
          {language === "all"
            ? "Latin / English names use the fast English catalog. Japanese, Korean, Chinese, etc. in your query searches every region. "
            : language === "en"
            ? `Loaded ${sets.length.toLocaleString()} live sets from the English public card catalog. `
            : `Loaded ${sets.length.toLocaleString()} ${CARD_LANGUAGE_FILTERS.find((item) => item.code === language)?.label} sets from that language's own catalog. `}
          {typeof totalPages === "number"
            ? `Showing page ${searchResponse.page} of ${totalPages}.`
            : `Showing browse page ${searchResponse.page}.`}
        </p>
      </section>

      <SearchResults
        results={searchResponse.results}
        query={query}
        totalCount={searchResponse.totalCount}
        notice={searchResponse.notice}
      />

      {searchResponse.page > 1 || searchResponse.hasNextPage ? (
        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="text-sm text-slate-400 sm:max-w-[65%]">
            {typeof searchResponse.totalCount === "number"
              ? `Showing ${(searchResponse.page - 1) * searchResponse.pageSize + 1}-${Math.min(
                  searchResponse.page * searchResponse.pageSize,
                  searchResponse.totalCount,
                )} of ${searchResponse.totalCount.toLocaleString()} matches`
              : `Showing browse results on page ${searchResponse.page}`}
          </p>
          <div className="flex w-full gap-3 sm:w-auto">
            <a
              href={buildSearchHref(searchResponse.page - 1)}
              aria-disabled={searchResponse.page <= 1}
              className={`flex-1 rounded-2xl px-4 py-2 text-center text-sm font-semibold transition-colors sm:flex-none ${
                searchResponse.page <= 1
                  ? "pointer-events-none border border-white/10 text-slate-500"
                  : "border border-white/10 text-slate-200 hover:border-white/20 hover:text-white"
              }`}
            >
              Previous
            </a>
            <a
              href={buildSearchHref(searchResponse.page + 1)}
              aria-disabled={!searchResponse.hasNextPage}
              className={`flex-1 rounded-2xl px-4 py-2 text-center text-sm font-semibold transition-colors sm:flex-none ${
                !searchResponse.hasNextPage
                  ? "pointer-events-none border border-white/10 text-slate-500"
                  : "bg-blue-500 text-white hover:bg-blue-400"
              }`}
            >
              Next
            </a>
          </div>
        </section>
      ) : null}
    </main>
  );
}
