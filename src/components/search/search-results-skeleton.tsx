export function SearchResultsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="h-8 w-48 animate-pulse rounded-xl bg-white/10" />
        <div className="h-5 w-56 animate-pulse rounded-lg bg-white/8" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((item) => (
          <div
            key={item}
            className="glass-card flex animate-pulse gap-5 rounded-3xl p-5 sm:flex-row"
          >
            <div className="h-36 w-28 shrink-0 rounded-2xl bg-white/10" />
            <div className="flex flex-1 flex-col gap-3">
              <div className="h-6 w-2/3 rounded-lg bg-white/10" />
              <div className="h-4 w-1/2 rounded-lg bg-white/8" />
              <div className="mt-2 flex gap-2">
                <div className="h-7 w-20 rounded-full bg-white/10" />
                <div className="h-7 w-24 rounded-full bg-white/10" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
