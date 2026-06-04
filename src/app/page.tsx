import Link from "next/link";
import Image from "next/image";

import { ClientPrice } from "@/components/client-price";
import { getFeaturedCards } from "@/lib/cards";
import { searchLiveCards } from "@/lib/pokemon-tcg-api";
import type { TcgCard } from "@/types/pokemon";

export const revalidate = 3600;

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

async function getHomepageMarketPicks(limit = 3): Promise<TcgCard[]> {
  try {
    const response = await searchLiveCards("", undefined, 1, "en", "price-desc");
    const liveCards = response.results
      .map((result) => result.card)
      .filter((card) => card.marketPriceUsd > 0);

    if (liveCards.length >= limit) {
      return liveCards.slice(0, limit);
    }

    if (liveCards.length) {
      const seenSlugs = new Set(liveCards.map((card) => card.slug));
      const fallbackCards = getFeaturedCards(limit).filter((card) => !seenSlugs.has(card.slug));
      return [...liveCards, ...fallbackCards].slice(0, limit);
    }
  } catch {
    // Keep the homepage usable if the upstream catalog is temporarily unavailable.
  }

  return getFeaturedCards(limit);
}

export default async function Home() {
  const featuredCards = await getHomepageMarketPicks(3);
  const heroCards = featuredCards.slice(0, 3);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-4 sm:gap-16 sm:px-10 sm:py-10 lg:px-12">
      <section className="route-hero relative overflow-hidden border-2 border-yellow-200/60 p-4 shadow-[0_0_0_3px_#050816,10px_10px_0_rgba(0,0,0,0.38)] sm:p-8 lg:p-10">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />

        <div className="relative z-10 grid gap-5 lg:grid-cols-[1.02fr_0.8fr] lg:items-center lg:gap-8">
          <div className="max-w-3xl space-y-4 lg:space-y-6">
            <span className="premium-kicker max-sm:w-full max-sm:justify-center">
              TCG market terminal
            </span>
            <div className="space-y-3 sm:space-y-4">
              <h1 className="section-title pokemon-display-title mb-4 max-w-4xl text-[2rem] text-white sm:mb-5 sm:text-6xl">
                PokePokedex
              </h1>
              <p className="premium-hero-copy max-w-2xl p-3.5 text-[0.86rem] leading-7 sm:p-4 sm:text-base sm:leading-7">
                Catch exact cards, check live market signals, compare graded prices, and build a
                binder that feels like a real trainer tool.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 text-[0.68rem] font-bold uppercase tracking-[0.1em] sm:text-xs sm:tracking-[0.12em]">
              <span className="premium-chip">Exact lookup</span>
              <span className="premium-chip">Graded prices</span>
              <span className="premium-chip">Binder ready</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1 sm:gap-3 sm:pt-0">
              <Link
                href="/search"
                className="trainer-button flex-1 bg-blue-500 px-5 py-3 text-center text-sm font-bold text-white sm:flex-none"
              >
                Open Card Dex
              </Link>
              <Link
                href="/portfolio"
                className="pixel-secondary-button flex-1 px-5 py-3 text-center text-sm font-bold sm:flex-none"
              >
                View Binder
              </Link>
            </div>
          </div>

          <div className="hero-card-poster relative order-first mx-auto w-full max-w-md lg:order-last lg:mx-0 lg:ml-auto">
            <div className="hero-card-glow" />
            <div className="hero-card-stage">
              <div className="hero-stage-header">
                <span>Market Picks</span>
                <strong>Live Card Board</strong>
              </div>
              {heroCards.map((card, index) => (
                <Link
                  key={card.slug}
                  href={`/cards/${card.slug}`}
                  className={`hero-real-card hero-real-card-${index + 1}`}
                >
                  <Image
                    src={card.image}
                    alt={card.name}
                    fill
                    sizes="(max-width: 768px) 42vw, 190px"
                    priority={index === 0}
                    className="object-contain"
                  />
                  <span className="hero-card-label">
                    <strong>{card.name}</strong>
                    <span>{card.setCode} #{card.collectorNumber}</span>
                  </span>
                </Link>
              ))}
            </div>
            <div className="hero-poster-caption">
              <span>Live Preview</span>
              <strong>Card Board</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <h2 className="section-title text-3xl">Market Picks</h2>
            <p className="section-copy max-w-3xl">
              Jump into tracked cards with price, population, and detail views ready.
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
                    {card.setName} - #{card.collectorNumber}
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
