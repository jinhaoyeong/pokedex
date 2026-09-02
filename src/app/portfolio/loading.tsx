export default function PortfolioLoading() {
  return (
    <main className="app-main app-frame flex min-h-screen w-full flex-col" aria-hidden="true">
      <section className="binder-hero route-hero relative p-4 sm:p-10 lg:p-12">
        <div className="binder-hero-grid relative z-10 grid gap-3 sm:gap-6 lg:grid-cols-[1.02fr_0.8fr] lg:items-center lg:gap-10">
          <div className="binder-hero-copy max-w-3xl space-y-3 sm:space-y-5">
            <div className="h-4 w-28 animate-pulse rounded-full bg-white/10" />
            <div className="h-10 w-[min(100%,22rem)] animate-pulse rounded-sm bg-white/12 sm:h-14" />
            <div className="h-16 w-full max-w-xl animate-pulse rounded-md bg-white/8" />
            <div className="flex gap-3 pt-1">
              <div className="h-11 w-32 animate-pulse rounded-xl bg-white/10" />
              <div className="h-11 w-32 animate-pulse rounded-xl bg-white/6" />
            </div>
          </div>
          <div className="hero-card-poster relative order-first mx-auto w-full max-w-md lg:order-last lg:mx-0 lg:ml-auto">
            <div className="hero-card-stage min-h-[12rem] animate-pulse bg-white/6 sm:min-h-[16rem]" />
          </div>
        </div>
      </section>
      <section className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-3xl bg-white/6" />
          ))}
        </div>
      </section>
    </main>
  );
}
