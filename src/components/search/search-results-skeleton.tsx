export function SearchResultsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="h-8 w-48 animate-pulse rounded-xl bg-white/10" />
        <div className="h-5 w-56 animate-pulse rounded-lg bg-white/8" />
      </div>
      <div className="search-result-grid grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-4 xl:grid-cols-5">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((item) => (
          <div
            key={item}
            className="search-result-card search-result-tile glass-card flex animate-pulse flex-col gap-1.5 rounded-2xl p-2 sm:p-2.5"
          >
            <div className="aspect-[0.716/1] w-full rounded-xl bg-white/10" />
            <div className="h-4 w-3/4 rounded-md bg-white/10" />
            <div className="h-3 w-1/2 rounded-md bg-white/8" />
            <div className="mt-1 h-5 w-20 rounded-md bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
