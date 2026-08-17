export function CardDetailSkeleton() {
  return (
    <main
      className="app-main mx-auto flex w-full max-w-[92rem] flex-col gap-4 px-3 py-5 pb-6 sm:px-6 sm:py-8"
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

      <section className="glass-card min-h-[30rem] animate-pulse rounded-3xl border-yellow-200/20 p-4 sm:min-h-[34rem] sm:p-6" />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,24rem)]">
        <div className="flex flex-col gap-4">
          <div className="glass-card h-56 animate-pulse rounded-2xl sm:h-64" />
          <div className="glass-card h-72 animate-pulse rounded-2xl sm:h-80" />
        </div>
        <div className="glass-card h-96 animate-pulse rounded-2xl" />
      </section>
    </main>
  );
}
