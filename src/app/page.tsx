import Link from "next/link";
import Image from "next/image";

import { ClientPrice } from "@/components/client-price";
import { getLivePreviewCards } from "@/lib/preview-cards";

export const revalidate = 3600;

const pillars = [
  {
    title: "Card Dex",
    description: "Search by name, set, collector number, and language.",
  },
  {
    title: "Market",
    description: "Check raw price, graded value, sold comps, and confidence.",
  },
  {
    title: "Binder",
    description: "Track cards, cost basis, value, and performance.",
  },
];

export default async function Home() {
  const featuredCards = await getLivePreviewCards(3);
  const heroCards = featuredCards.slice(0, 3);

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="basecamp-hero route-hero relative overflow-hidden p-5 sm:p-10 lg:p-12">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />

        <div className="relative z-10 grid gap-8 lg:grid-cols-[1.02fr_0.8fr] lg:items-center lg:gap-12">
          <div className="basecamp-hero-copy max-w-3xl space-y-6 lg:space-y-7">
            <span className="premium-kicker max-sm:w-full max-sm:justify-center">
              TCG market terminal
            </span>
            <div>
              <h1 className="section-title pokemon-display-title basecamp-brand-title mb-3 max-w-4xl text-[1.85rem] text-white sm:mb-5 sm:text-6xl">
                PokePokedex
              </h1>
            </div>
            <p className="hero-subline max-w-xl">
              Search cards, read live market signals, and track your binder in one clean flow.
            </p>
            <div className="hero-actions flex flex-wrap gap-3 pt-1 sm:gap-4 sm:pt-0">
              <Link
                href="/search"
                className="trainer-button flex-1 bg-blue-500 px-4 py-2.5 text-center text-sm font-bold text-white sm:flex-none sm:px-5 sm:py-3"
              >
                Open Card Dex
              </Link>
              <Link
                href="/portfolio"
                className="pixel-secondary-button flex-1 px-4 py-2.5 text-center text-sm font-bold sm:flex-none sm:px-5 sm:py-3"
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

      <section className="basecamp-content-section space-y-6 sm:space-y-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h2 className="basecamp-section-title">Market Picks</h2>
          </div>
          <Link
            href="/search"
            className="hidden rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 hover:text-white md:inline-flex"
          >
            Open Card Dex
          </Link>
        </div>
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
          {featuredCards.map((card, index) => (
            <Link
              key={`${card.slug}__${index}`}
              href={`/cards/${card.slug}`}
              className="basecamp-market-card group grid grid-cols-[6rem_minmax(0,1fr)] gap-4 rounded-2xl p-4 transition duration-200 hover:-translate-y-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:p-5 lg:grid-cols-1 lg:p-6"
            >
              <div className="basecamp-market-image relative aspect-[0.72/1] overflow-hidden rounded-xl lg:mx-auto lg:w-full lg:max-w-[9.5rem]">
                <Image
                  src={card.image}
                  alt={card.name}
                  fill
                  sizes="(max-width: 640px) 84px, (max-width: 1024px) 96px, 152px"
                  className="object-contain p-1.5 transition duration-200 group-hover:scale-[1.03]"
                />
              </div>

              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-200">
                      Live pick {index + 1}
                    </p>
                    <h3 className="mt-1 break-words text-base font-semibold leading-tight text-white sm:text-lg">
                      {card.name}
                    </h3>
                  </div>
                  <ClientPrice
                    amountUsd={card.marketPriceUsd}
                    className="shrink-0 text-right text-base font-semibold leading-none text-blue-200 sm:text-lg lg:text-xl"
                  />
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {card.setName} / #{card.collectorNumber}
                </p>
                <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  {card.setCode} / {card.rarity} / {card.languageLabel}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="basecamp-content-section space-y-6 sm:space-y-7">
        <div className="space-y-2">
          <h2 className="basecamp-section-title">Trainer Modules</h2>
        </div>
        <div className="grid gap-4 sm:gap-5 md:grid-cols-3">
          {pillars.map((pillar, index) => (
            <article
              key={pillar.title}
              className="basecamp-module-card rounded-2xl p-5 transition duration-200 hover:-translate-y-1 sm:p-7"
            >
              <span className="basecamp-module-index">0{index + 1}</span>
              <h3 className="text-xl font-semibold text-white">{pillar.title}</h3>
              <p className="section-copy mt-3 text-sm">{pillar.description}</p>
            </article>
          ))}
        </div>
      </section>

    </main>
  );
}
