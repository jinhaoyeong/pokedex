import Link from "next/link";

import { ClientPrice } from "@/components/client-price";
import { getFeaturedCards } from "@/lib/cards";

const pillars = [
  {
    title: "Card Dex",
    description:
      "Find Pokemon TCG cards by set, collector number, name, and future filters tuned for exact card identity.",
  },
  {
    title: "Market Sense",
    description:
      "Track raw price, graded estimates, last sold records, population data, and confidence over time.",
  },
  {
    title: "Binder Vault",
    description:
      "Store raw and graded holdings with cost basis, valuation, and currency-aware performance.",
  },
  {
    title: "Trainer Tools",
    description:
      "Use a phone or desktop camera to read card details and rank the most likely matches.",
  },
];

const roadmap = [
  "Sharpen exact card-code lookup",
  "Map language-specific packs and sets",
  "Track graded and raw market movement",
  "Build a collection binder with currency views",
  "Surface population data with source notes",
  "Prepare camera scan-to-search",
];

export default function Home() {
  const featuredCards = getFeaturedCards();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-3 py-5 sm:gap-20 sm:px-10 sm:py-10 lg:px-12">
      <section className="relative overflow-hidden rounded-[1.5rem] border border-yellow-200/20 bg-gradient-to-br from-[#10285f] via-[#0c1635] to-[#14111f] p-4 shadow-2xl shadow-blue-950/30 sm:rounded-[2rem] sm:p-10 lg:p-14">
        <div className="absolute right-8 top-8 hidden h-28 w-28 rounded-full border-[18px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-70 lg:block" />
        <div className="flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl space-y-5 sm:space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-yellow-300/30 bg-yellow-300/12 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-yellow-100 sm:px-4 sm:text-sm sm:tracking-[0.18em]">
              <span className="energy-spark" />
              Live TCG command center
            </span>
            <div className="space-y-4">
              <h1 className="section-title max-w-3xl">
                Catch exact cards, compare markets, and build a smarter Pokemon binder.
              </h1>
              <p className="section-copy max-w-2xl text-base sm:text-lg">
                Search by collector code, explore language-specific packs, inspect population data,
                and keep your chase cards organized like a proper trainer.
              </p>
            </div>
            <div className="grid gap-3 sm:flex sm:flex-wrap">
              <Link
                href="/search"
                className="trainer-button rounded-full bg-blue-500 px-5 py-3 text-center text-sm font-black text-white"
              >
                Open Card Dex
              </Link>
              <Link
                href="/portfolio"
                className="rounded-full border border-yellow-200/30 bg-white/8 px-5 py-3 text-center text-sm font-black text-yellow-100 transition hover:border-yellow-200/60 hover:bg-yellow-200/12"
              >
                View Binder
              </Link>
            </div>
          </div>
          <div className="relative mx-auto grid w-full max-w-[17rem] place-items-center py-1 sm:max-w-sm sm:py-6 lg:mx-0">
            <div className="energy-orbit" />
            <div className="card-float w-full rounded-[1.25rem] border border-yellow-200/30 bg-gradient-to-br from-yellow-200 via-white to-blue-100 p-2 shadow-2xl shadow-black/30 sm:rounded-[1.6rem] sm:p-3">
              <div className="rounded-[0.9rem] border-4 border-yellow-500 bg-[#0b1022] p-3 sm:rounded-[1.1rem] sm:p-4">
                <div className="flex items-center justify-between text-[#111827]">
                  <span className="rounded-full bg-yellow-300 px-3 py-1 text-xs font-black uppercase">
                    Rare Find
                  </span>
                  <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-black text-white">
                    HP 120
                  </span>
                </div>
                <div className="mt-3 grid aspect-[4/3] place-items-center rounded-xl bg-gradient-to-br from-sky-400 via-yellow-200 to-emerald-300 sm:mt-4">
                  <div className="relative grid h-16 w-16 place-items-center rounded-full border-[9px] border-[#111827] bg-white sm:h-24 sm:w-24 sm:border-[12px]">
                    <div className="absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-red-500" />
                    <div className="z-10 h-6 w-6 rounded-full border-[6px] border-[#111827] bg-white sm:h-8 sm:w-8 sm:border-8" />
                  </div>
                </div>
                <div className="mt-3 space-y-2 sm:mt-4">
                  <p className="text-xl font-black text-yellow-100 sm:text-2xl">PokePokedex</p>
                  <div className="h-2 rounded-full bg-blue-400/80" />
                  <div className="h-2 w-3/4 rounded-full bg-yellow-300/90" />
                </div>
              </div>
            </div>
            <div className="mt-3 grid w-full grid-cols-3 gap-2 text-center text-[0.65rem] font-black uppercase tracking-[0.08em] text-slate-950 sm:mt-5 sm:gap-3 sm:text-xs">
              <span className="rounded-full bg-yellow-300 px-2 py-2 sm:px-3">Electric</span>
              <span className="rounded-full bg-sky-300 px-2 py-2 sm:px-3">Water</span>
              <span className="rounded-full bg-emerald-300 px-2 py-2 sm:px-3">Grass</span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <h2 className="section-title text-3xl">Featured Pulls</h2>
            <p className="section-copy max-w-3xl">
              A quick look at cards already wired into the binder, with market data,
              population notes, and detail pages ready to inspect.
            </p>
          </div>
          <Link
            href="/search"
            className="hidden rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 hover:text-white md:inline-flex"
          >
            Open Card Dex
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featuredCards.map((card, index) => (
            <Link
              key={`${card.slug}__${index}`}
              href={`/cards/${card.slug}`}
              className="glass-card rounded-3xl p-4 transition duration-200 hover:-translate-y-1 hover:rotate-[0.4deg] sm:p-6"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
              <div className="mt-5 flex flex-wrap gap-3 text-xs font-bold text-slate-200">
                <span className="type-chip rounded-full px-3 py-1">
                  {card.rarity}
                </span>
                <span className="type-chip rounded-full px-3 py-1">
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
          <h2 className="section-title text-3xl">Trainer Modules</h2>
          <p className="section-copy max-w-3xl">
            Each module below comes directly from the agreed execution tracker.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((pillar) => (
            <article
              key={pillar.title}
              className="glass-card rounded-2xl p-6 transition duration-200 hover:-translate-y-1 hover:border-yellow-200/45"
            >
              <h3 className="text-xl font-semibold text-white">{pillar.title}</h3>
              <p className="section-copy mt-3 text-sm">{pillar.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <article className="glass-card rounded-3xl p-6 sm:p-8">
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

        <article className="glass-card rounded-3xl p-6 sm:p-8">
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
