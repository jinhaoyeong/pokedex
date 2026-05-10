import Link from "next/link";

import { ClientPrice } from "@/components/client-price";
import { getFeaturedCards } from "@/lib/cards";

const pillars = [
  {
    title: "Card Search",
    description:
      "Find Pokemon TCG cards by set, collector number, name, and future filters tuned for exact card identity.",
  },
  {
    title: "Market Intelligence",
    description:
      "Track raw price, graded estimates, last sold records, population data, and confidence over time.",
  },
  {
    title: "Portfolio",
    description:
      "Store raw and graded holdings with cost basis, valuation, and currency-aware performance.",
  },
  {
    title: "Scan To Find",
    description:
      "Use a phone or desktop camera to read card details and rank the most likely matches.",
  },
];

const roadmap = [
  "Foundation scaffold and app shell",
  "Canonical set and card data model",
  "Search by set and collector number",
  "Card detail pages with normalized data",
  "Market and sold-history ingestion pipeline",
  "Portfolio and currency selector",
  "Camera scan-to-search",
];

export default function Home() {
  const featuredCards = getFeaturedCards();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-20 px-6 py-10 sm:px-10 lg:px-12">
      <section className="glass-card rounded-3xl p-8 shadow-2xl shadow-blue-950/20 sm:p-10 lg:p-14">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-6">
            <span className="inline-flex rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-200">
              Pokemon TCG Intelligence Platform
            </span>
            <div className="space-y-4">
              <h1 className="section-title max-w-3xl">
                Building a Pokemon TCG Pokedex app for search, market data,
                portfolio tracking, and scan-to-find.
              </h1>
              <p className="section-copy max-w-2xl text-base sm:text-lg">
                The project now has a working local canonical card layer and is
                moving through search, card detail, and portfolio flows while
                the database setup is deferred.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/search"
                className="rounded-full bg-blue-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-400"
              >
                Search Cards
              </Link>
              <Link
                href="/portfolio"
                className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-white/20 hover:text-white"
              >
                View Portfolio
              </Link>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="glass-card rounded-2xl p-5">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-400">
                Default Currency
              </p>
              <p className="mt-3 text-3xl font-semibold text-white">USD</p>
            </div>
            <div className="glass-card rounded-2xl p-5">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-400">
                Delivery Target
              </p>
              <p className="mt-3 text-3xl font-semibold text-white">
                Web + Mobile
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-3">
            <h2 className="section-title text-3xl">Featured Cards</h2>
            <p className="section-copy max-w-3xl">
              Local canonical data is live now, so search and detail screens can
              already work against stable card records.
            </p>
          </div>
          <Link
            href="/search"
            className="hidden rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 hover:text-white md:inline-flex"
          >
            Open Search
          </Link>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {featuredCards.map((card) => (
            <Link
              key={card.id}
              href={`/cards/${card.slug}`}
              className="glass-card rounded-3xl p-6 transition-transform duration-200 hover:-translate-y-1"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-white">{card.name}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {card.setName} · #{card.collectorNumber}
                  </p>
                </div>
                <ClientPrice
                  amountUsd={card.marketPriceUsd}
                  className="text-lg font-semibold text-blue-300"
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-3 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 px-3 py-1">
                  {card.rarity}
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1">
                  {card.psaPopulation.grades[0]
                    ? `${card.psaPopulation.grades[0].grade} Pop ${card.psaPopulation.grades[0].count.toLocaleString()}`
                    : "PSA pop pending"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-3">
          <h2 className="section-title text-3xl">Build Pillars</h2>
          <p className="section-copy max-w-3xl">
            Each module below comes directly from the agreed execution tracker.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((pillar) => (
            <article
              key={pillar.title}
              className="glass-card rounded-2xl p-6 transition-transform duration-200 hover:-translate-y-1"
            >
              <h3 className="text-xl font-semibold text-white">{pillar.title}</h3>
              <p className="section-copy mt-3 text-sm">{pillar.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <article className="glass-card rounded-3xl p-8">
          <h2 className="text-2xl font-semibold text-white">
            Immediate roadmap
          </h2>
          <ol className="mt-6 space-y-4">
            {roadmap.map((step, index) => (
              <li
                key={step}
                className="flex items-start gap-4 rounded-2xl border border-white/8 bg-white/3 p-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-sm font-semibold text-blue-200">
                  {index + 1}
                </span>
                <span className="text-sm text-slate-200 sm:text-base">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </article>

        <article className="glass-card rounded-3xl p-8">
          <h2 className="text-2xl font-semibold text-white">Data promises</h2>
          <ul className="mt-6 space-y-4 text-sm text-slate-200 sm:text-base">
            <li>Store source provenance and fetch timestamps.</li>
            <li>Show stale or low-confidence market data honestly.</li>
            <li>Normalize raw, graded, and sold data into one model.</li>
            <li>Ask for direction before major architectural changes.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
