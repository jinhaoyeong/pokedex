export default function SearchLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <section className="h-40 animate-pulse rounded-[1.5rem] border border-white/10 bg-white/5 sm:rounded-[2rem] sm:h-48" />
      <section className="glass-card h-48 animate-pulse rounded-3xl bg-white/5" />
      <div className="search-result-grid grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div
            key={i}
            className="glass-card flex animate-pulse flex-col gap-2 rounded-2xl p-2.5 sm:p-3"
          >
            <div className="aspect-[0.716/1] w-full rounded-xl bg-white/10" />
            <div className="h-4 w-3/4 rounded-md bg-white/10" />
            <div className="h-3 w-1/2 rounded-md bg-white/8" />
            <div className="mt-1 h-5 w-20 rounded-md bg-white/10" />
          </div>
        ))}
      </div>
    </main>
  );
}
