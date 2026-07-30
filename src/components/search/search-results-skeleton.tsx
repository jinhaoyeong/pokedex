export function SearchResultsSkeleton() {
  return (
    <div className="dex-results-workspace" aria-label="Loading cards">
      <div className="dex-results-toolbar">
        <div>
          <div className="h-3 w-14 animate-pulse rounded bg-white/10" />
          <div className="mt-2 h-8 w-48 animate-pulse rounded-lg bg-white/10" />
        </div>
        <div className="h-5 w-56 animate-pulse rounded-lg bg-white/8" />
      </div>
      <div className="dex-result-grid">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
          <div
            key={item}
            className="dex-result-skeleton glass-card animate-pulse"
          >
            <div className="dex-result-skeleton-media bg-white/10" />
            <div className="dex-result-skeleton-body">
              <div className="h-5 w-2/3 rounded-lg bg-white/10" />
              <div className="h-4 w-1/2 rounded-lg bg-white/8" />
              <div className="mt-auto flex gap-2">
                <div className="h-6 w-16 rounded-full bg-white/10" />
                <div className="h-6 w-20 rounded-full bg-white/10" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
