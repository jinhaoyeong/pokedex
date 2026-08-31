import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";

export default function SearchLoading() {
  return (
    <main className="app-main search-page-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="sheet dex-hero" aria-hidden="true">
        <div className="sheet-band">
          <span className="sheet-band-title">Card index</span>
        </div>
        <div className="dex-hero-body">
          <div className="dex-hero-copy space-y-3">
            <div className="h-10 w-[min(100%,22rem)] animate-pulse rounded-sm bg-white/10" />
            <div className="h-4 w-[min(100%,28rem)] animate-pulse rounded-sm bg-white/8" />
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
              <div className="h-10 animate-pulse rounded-sm bg-white/6" />
              <div className="h-10 animate-pulse rounded-sm bg-white/6" />
              <div className="h-10 animate-pulse rounded-sm bg-white/6" />
            </div>
          </div>
        </div>
      </section>
      <section className="sheet sheet-open search-sheet" aria-hidden="true">
        <div className="sheet-band">
          <span className="sheet-band-title">Search</span>
        </div>
        <div className="search-sheet-body">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
            <div className="h-11 animate-pulse rounded-md bg-white/10" />
            <div className="h-11 animate-pulse rounded-md bg-white/8" />
            <div className="h-11 animate-pulse rounded-md bg-white/8" />
          </div>
          <div className="search-scan-row">
            <div className="h-9 w-32 animate-pulse rounded-md bg-white/8" />
          </div>
        </div>
      </section>
      <SearchResultsSkeleton />
    </main>
  );
}
