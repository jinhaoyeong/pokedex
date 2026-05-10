import type { Metadata } from "next";

import { SearchResults } from "@/components/search/search-results";
import { fetchLiveSets, searchLiveCards } from "@/lib/pokemon-tcg-api";

export const metadata: Metadata = {
  title: "Search",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; set?: string }>;
}) {
  const params = await searchParams;
  const query = params.q ?? "";
  const setFilter = params.set ?? "";
  const [results, sets] = await Promise.all([
    searchLiveCards(query, setFilter),
    fetchLiveSets(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-6 py-10 sm:px-10 lg:px-12">
      <section className="space-y-4">
        <span className="inline-flex rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-200">
          Search by set and collector number
        </span>
        <h1 className="section-title max-w-4xl">
          Search Pokemon TCG cards by set, collector number, or name.
        </h1>
        <p className="section-copy max-w-3xl">
          This search now pulls from a live public card catalog instead of the
          tiny preset dataset, so the set list and card search are no longer
          limited to only a few hardcoded examples.
        </p>
      </section>

      <section className="glass-card rounded-3xl p-6">
        <form className="grid gap-4 lg:grid-cols-[1.5fr_1fr_auto]">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Try Charizard, 203, Base Set, or Umbreon ex"
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <select
            name="set"
            defaultValue={setFilter}
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
          >
            <option value="">All sets</option>
            {sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name} ({set.code})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-2xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-400"
          >
            Search
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-400">
          Loaded {sets.length.toLocaleString()} live sets from the public card
          catalog.
        </p>
      </section>

      <SearchResults results={results} query={query} />
    </main>
  );
}
