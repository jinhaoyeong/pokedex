import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";

export default function SearchLoading() {
  return (
    <main className="app-main search-page-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="search-hero relative overflow-hidden px-4 py-3 sm:px-8 sm:py-5 lg:px-10 lg:py-6">
        <div className="carddex-hero-copy space-y-2 sm:space-y-2.5">
          <div className="h-3 w-28 animate-pulse rounded-full bg-white/10" />
          <div className="h-8 w-[min(100%,22rem)] animate-pulse rounded-lg bg-white/10 sm:h-10" />
          <div className="h-4 w-[min(100%,18rem)] animate-pulse rounded-md bg-white/8" />
        </div>
      </section>
      <section className="search-panel glass-card rounded-3xl p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
          <div className="h-11 animate-pulse rounded-xl bg-white/10" />
          <div className="h-11 animate-pulse rounded-xl bg-white/8" />
          <div className="h-11 animate-pulse rounded-xl bg-white/8" />
        </div>
      </section>
      <SearchResultsSkeleton />
    </main>
  );
}
