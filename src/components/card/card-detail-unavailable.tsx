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
          className="breadcrumb-link"
        >
          Card Dex
        </Link>
        <span className="text-slate-500">/</span>
        <span className="text-[var(--text-dim)]">Lookup unavailable</span>
      </nav>

      <section className="route-hero relative overflow-hidden p-4 sm:p-8 lg:p-10">
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
              className="btn btn-primary flex-1 sm:flex-none"
            >
              Back to Search
            </Link>
            <Link
              href="/"
              className="btn btn-ghost flex-1 sm:flex-none"
            >
              Main Page
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
