import { SEARCH_RESULT_GRID_CLASS } from "@/lib/search-result-grid";

export function SearchResultTileSkeleton() {
  return (
    <div className="search-result-card search-result-tile glass-card flex h-full flex-col rounded-[1rem] px-3.5 pb-3.5 pt-3.5 sm:px-4 sm:pb-4 sm:pt-4">
      <div className="search-result-art mx-auto">
        <div className="search-result-art-frame aspect-[0.716/1] w-full animate-pulse rounded-[0.72rem] bg-white/10" />
      </div>
      <div className="search-result-copy mt-3 flex min-h-0 flex-col">
        <div className="h-4 w-[78%] animate-pulse rounded-md bg-white/10" />
        <div className="mt-2 h-3 w-[64%] animate-pulse rounded-md bg-white/8" />
        <div className="search-result-attributes mt-1.5">
          <div className="h-3 w-[46%] animate-pulse rounded-md bg-white/8" />
        </div>
      </div>
      <div className="search-result-rule" aria-hidden="true" />
      <div className="search-result-market">
        <div className="h-2 w-16 animate-pulse rounded bg-white/8" />
        <div className="mt-2 h-5 w-[72%] animate-pulse rounded-md bg-white/10" />
      </div>
    </div>
  );
}

export function SearchResultsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="h-8 w-52 animate-pulse rounded-xl bg-white/10" />
        <div className="h-5 w-64 animate-pulse rounded-lg bg-white/8" />
      </div>
      <div className={SEARCH_RESULT_GRID_CLASS}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
          <SearchResultTileSkeleton key={item} />
        ))}
      </div>
    </div>
  );
}
