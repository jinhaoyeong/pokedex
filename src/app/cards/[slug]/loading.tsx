export default function CardDetailLoading() {
  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-[92rem] flex-col">
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-400">
        <span className="h-9 w-24 animate-pulse rounded-xl border border-white/10 bg-white/5" />
        <span>/</span>
        <span className="h-9 w-40 animate-pulse rounded-xl bg-yellow-200/10" />
      </div>

      <div className="rounded-2xl border border-blue-300/25 bg-blue-500/10 px-4 py-3 text-sm font-semibold text-blue-100">
        Opening card and loading market data...
      </div>

      <section className="grid items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)]">
        <div className="glass-card min-h-[24rem] animate-pulse rounded-2xl border-yellow-200/20 p-5 sm:min-h-[30rem] sm:p-6" />
        <div className="space-y-5">
          <div className="glass-card min-h-[18rem] animate-pulse rounded-2xl border-yellow-200/20 p-5 sm:min-h-[22rem] sm:p-7" />
          <div className="glass-card h-24 animate-pulse rounded-2xl p-5 sm:p-6" />
        </div>
      </section>

      <section className="grid gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,26rem)]">
        <div className="glass-card h-80 animate-pulse rounded-2xl p-5 sm:h-96 sm:p-6" />
        <div className="space-y-5">
          <div className="glass-card h-72 animate-pulse rounded-2xl p-5 sm:p-6" />
          <div className="glass-card h-40 animate-pulse rounded-2xl p-5 sm:p-6" />
        </div>
      </section>
    </main>
  );
}
