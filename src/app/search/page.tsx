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
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full border-[14px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:-right-10 sm:-top-10 sm:h-36 sm:w-36 sm:border-[18px] sm:opacity-35" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-center">
          <div className="space-y-3 sm:space-y-4">
            <span className="premium-kicker">
              Card Dex scanner
            </span>
            <h1 className="section-title max-w-4xl text-4xl sm:text-6xl">
              Find cards by name, set, or number.
            </h1>
            <p className="section-copy max-w-3xl">
              Search across English, Japanese, Chinese, Korean, and more. Collector numbers like
              100/095 work too.
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
            ? "Names, local text, and collector numbers search every region. "
            : language === "en"
            ? `${sets.length.toLocaleString()} English sets loaded. `
            : `${sets.length.toLocaleString()} ${CARD_LANGUAGE_FILTERS.find((item) => item.code === language)?.label} sets loaded. `}
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
