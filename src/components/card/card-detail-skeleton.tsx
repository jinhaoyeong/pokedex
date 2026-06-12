export function CardDetailSkeleton() {
  return (
    <main
      className="app-main mx-auto flex min-h-screen w-full max-w-[92rem] flex-col gap-5 px-3 py-5 sm:gap-6 sm:px-6 sm:py-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm font-bold text-slate-400">
        <span className="h-9 w-24 animate-pulse rounded-xl border border-white/10 bg-white/5" />
        <span>/</span>
        <span className="h-9 w-40 max-w-[55vw] animate-pulse rounded-xl bg-yellow-200/10" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-200/80">
        Loading card details...
      </p>

      <section className="glass-card min-h-[28rem] animate-pulse rounded-2xl border-yellow-200/20 p-5 sm:min-h-[32rem] sm:p-7" />

      <section className="flex flex-col gap-5 sm:gap-6">
        <div className="grid gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,24rem)]">
          <div className="flex flex-col gap-5 sm:gap-6">
            <div className="glass-card h-56 animate-pulse rounded-2xl sm:h-64" />
            <div className="glass-card h-80 animate-pulse rounded-2xl sm:h-96" />
          </div>
          <div className="glass-card h-96 animate-pulse rounded-2xl" />
        </div>
        <div className="grid gap-5 sm:gap-6 md:grid-cols-2">
          <div className="glass-card h-40 animate-pulse rounded-2xl" />
          <div className="glass-card h-40 animate-pulse rounded-2xl" />
        </div>
      </section>
    </main>
  );
}
