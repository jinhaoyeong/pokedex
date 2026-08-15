export default function SearchLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <section className="h-40 animate-pulse rounded-[1.5rem] border border-white/10 bg-white/5 sm:rounded-[2rem] sm:h-48" />
      <section className="glass-card h-48 animate-pulse rounded-3xl bg-white/5" />
      <div className="search-result-grid grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-5 xl:grid-cols-5 xl:gap-6">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div
            key={i}
            className="glass-card flex animate-pulse flex-col rounded-[1.05rem] px-3 pb-3 pt-3 sm:px-3.5 sm:pb-3.5 sm:pt-3.5"
          >
            <div className="mx-auto aspect-[0.716/1] w-[70%] max-w-[7.75rem] rounded-md bg-white/10" />
            <div className="mt-3 h-4 w-3/4 rounded-md bg-white/10" />
            <div className="mt-2 h-3 w-1/2 rounded-md bg-white/8" />
            <div className="mt-auto pt-3 h-5 w-20 rounded-md bg-white/10" />
          </div>
        ))}
      </div>
    </main>
  );
}
