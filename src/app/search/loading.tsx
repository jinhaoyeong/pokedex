import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";

export default function SearchLoading() {
  return (
    <main className="app-main search-page-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="sheet sheet-open dex-hero" aria-hidden="true">
        <div className="sheet-band">
          <span className="sheet-band-title">Card index</span>
        </div>
        <div className="dex-hero-body">
          <div className="dex-hero-copy">
            <div className="h-10 w-[min(100%,24rem)] animate-pulse rounded-sm bg-white/10" />
            <div className="dex-search">
              <div className="dex-search-form">
                <div className="dex-search-field h-[3.4rem] animate-pulse rounded-xl bg-white/8" />
                <div className="h-[3.4rem] w-28 animate-pulse rounded-xl bg-white/10" />
              </div>
              <div className="dex-search-tools">
                <div className="h-[2.7rem] w-28 animate-pulse rounded-full bg-white/6" />
                <div className="h-[2.7rem] w-32 animate-pulse rounded-full bg-white/6" />
              </div>
            </div>
          </div>
        </div>
      </section>
      <SearchResultsSkeleton />
    </main>
  );
}
