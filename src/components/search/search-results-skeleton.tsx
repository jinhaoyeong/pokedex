export function SearchResultsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="h-8 w-48 animate-pulse rounded-xl bg-white/10" />
        <div className="h-5 w-56 animate-pulse rounded-lg bg-white/8" />
      </div>
      <div className="search-result-grid grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-6 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-7 xl:grid-cols-5 xl:gap-x-7 xl:gap-y-8">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((item) => (
          <div
            key={item}
            className="search-result-card search-result-tile glass-card flex h-full animate-pulse flex-col rounded-[1rem] px-3 pb-3 pt-3 sm:px-3.5 sm:pb-3.5 sm:pt-3.5"
          >
            <div className="search-result-art mx-auto w-[74%] max-w-[9rem]">
              <div className="search-result-art-frame aspect-[0.716/1] w-full rounded-[0.72rem] bg-white/10" />
            </div>
            <div className="search-result-copy mt-3 flex min-h-0 flex-1 flex-col">
              <div className="h-4 w-3/4 rounded-md bg-white/10" />
              <div className="mt-2 h-3 w-1/2 rounded-md bg-white/8" />
              <div className="search-result-market mt-auto pt-3">
                <div className="mb-1 h-2 w-16 rounded bg-white/8" />
                <div className="h-5 w-20 rounded-md bg-white/10" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
