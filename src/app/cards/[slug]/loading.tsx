export default function CardDetailLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <div className="flex items-center gap-3 text-sm font-bold text-slate-400">
        <span className="h-7 w-24 animate-pulse rounded-full border border-white/10 bg-white/5" />
        <span>/</span>
        <span className="h-7 w-32 animate-pulse rounded-full bg-yellow-200/10" />
      </div>

      <section className="grid gap-5 sm:gap-8 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="glass-card min-h-[34rem] animate-pulse rounded-[1.5rem] border-yellow-200/20 p-4 sm:rounded-[2rem] sm:p-6" />
        <div className="space-y-6">
          <section className="glass-card min-h-[24rem] animate-pulse rounded-[1.5rem] border-yellow-200/20 p-4 sm:rounded-[2rem] sm:p-6" />
          <section className="glass-card h-24 animate-pulse rounded-3xl p-4 sm:p-6" />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-card h-96 animate-pulse rounded-3xl p-4 sm:p-6" />
        <div className="glass-card h-96 animate-pulse rounded-3xl p-4 sm:p-6" />
      </section>
    </main>
  );
}
