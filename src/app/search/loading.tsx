export default function SearchLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <section className="h-40 animate-pulse rounded-[1.5rem] border border-white/10 bg-white/5 sm:rounded-[2rem] sm:h-48" />
      <section className="glass-card h-48 animate-pulse rounded-3xl bg-white/5" />
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
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
    </main>
  );
}
