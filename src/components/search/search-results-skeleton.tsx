import { SEARCH_RESULT_GRID_CLASS } from "@/lib/search-result-grid";

export function SearchResultTileSkeleton() {
  return (
    <div className="search-result-tile flex h-full flex-col">
      <div className="search-result-art mx-auto">
        <div className="search-result-art-frame aspect-[0.716/1] w-full animate-pulse rounded-[0.72rem] bg-white/10" />
      </div>
      <div className="search-result-copy mt-3 flex min-h-0 flex-col">
        <div className="h-4 w-[78%] animate-pulse rounded-md bg-white/10" />
        <div className="h-3 w-[64%] animate-pulse rounded-md bg-white/8" />
        <div className="search-result-attributes">
          <div className="h-4 w-[46%] animate-pulse rounded-full bg-white/8" />
        </div>
      </div>
      <div className="search-result-rule" aria-hidden="true" />
      <div className="search-result-market">
        <div className="h-2 w-12 animate-pulse rounded bg-white/8" />
        <div className="h-4 w-[52%] animate-pulse rounded-md bg-white/10" />
      </div>
    </div>
  );
}

export function SearchResultsSkeleton() {
  return (
    <section className="sheet results-sheet" aria-hidden="true">
      <div className="sheet-band">
        <span className="sheet-band-title">Results</span>
        <span className="h-3 w-40 animate-pulse rounded bg-white/10" />
      </div>
      <div className={SEARCH_RESULT_GRID_CLASS}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
          <SearchResultTileSkeleton key={item} />
        ))}
      </div>
    </section>
  );
}
