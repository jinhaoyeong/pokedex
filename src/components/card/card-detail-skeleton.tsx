export function CardDetailSkeleton() {
  return (
    <main
      className="app-main mx-auto flex min-h-screen w-full max-w-[88rem] flex-col gap-5 sm:gap-6"
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

      <section className="grid items-start gap-5 lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] xl:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)_minmax(15rem,18rem)]">
        <aside className="glass-card min-h-[20rem] animate-pulse rounded-2xl border-yellow-200/20 p-4" />
        <div className="space-y-4">
          <section className="glass-card min-h-[16rem] animate-pulse rounded-2xl border-yellow-200/20 p-5 sm:min-h-[18rem]" />
          <section className="glass-card h-36 animate-pulse rounded-2xl xl:hidden" />
        </div>
        <aside className="hidden min-h-[18rem] animate-pulse rounded-2xl border border-white/10 bg-white/5 xl:block" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)]">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="glass-card h-64 animate-pulse rounded-2xl sm:h-72" />
          <div className="glass-card h-64 animate-pulse rounded-2xl sm:h-72" />
        </div>
        <div className="glass-card h-80 animate-pulse rounded-2xl" />
      </section>
    </main>
  );
}
