import Link from "next/link";

export function CardDetailUnavailable() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <nav
        aria-label="Card detail breadcrumb"
        className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-300 sm:gap-3"
      >
        <Link
          href="/search"
          className="inline-flex min-h-9 items-center justify-center rounded-xl border border-yellow-200/25 bg-slate-950/45 px-3.5 py-2 text-center leading-none text-yellow-100 transition hover:border-yellow-200/55 hover:text-white"
        >
          Card Dex
        </Link>
        <span className="text-slate-500">/</span>
        <span className="text-yellow-100">Lookup unavailable</span>
      </nav>

      <section className="route-hero relative overflow-hidden border-2 border-yellow-200/60 p-4 shadow-[0_0_0_3px_#050816,10px_10px_0_rgba(0,0,0,0.38)] sm:p-8 lg:p-10">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />

        <div className="relative z-10 max-w-3xl space-y-4 lg:space-y-6">
          <span className="premium-kicker max-sm:w-full max-sm:justify-center">
            Live catalog timeout
          </span>
          <h1 className="section-title pokemon-display-title mb-4 max-w-4xl text-[2rem] text-white sm:mb-5 sm:text-6xl">
            This card is temporarily unavailable.
          </h1>
          <p className="premium-hero-copy max-w-2xl p-3.5 text-[0.86rem] leading-7 sm:p-4 sm:text-base sm:leading-7">
            The Pokemon TCG catalog did not respond in time. The app is still running, and this
            card can be opened again once the live catalog recovers.
          </p>
          <div className="flex flex-wrap gap-2 pt-1 sm:gap-3 sm:pt-0">
            <Link
              href="/search"
              className="trainer-button flex-1 bg-blue-500 px-5 py-3 text-center text-sm font-bold text-white sm:flex-none"
            >
              Back to Search
            </Link>
            <Link
              href="/"
              className="pixel-secondary-button flex-1 px-5 py-3 text-center text-sm font-bold sm:flex-none"
            >
              Main Page
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
