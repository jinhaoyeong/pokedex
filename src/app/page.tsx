import Link from "next/link";

import { HeroCardPoster } from "@/components/home/hero-card-poster";
import { MarketPicksGrid } from "@/components/home/market-picks-grid";
import { getLivePreviewCards, MARKET_PICKS_LIMIT } from "@/lib/preview-cards";

export const revalidate = 1800;

const pillars = [
  {
    title: "Card Dex",
    description: "Search by name, set, number, or language.",
    href: "/search",
    cta: "Search cards",
    accent: "#42a5ff",
  },
  {
    title: "Market",
    description: "Raw, graded, sold comps and confidence.",
    href: "/search?sort=price-desc",
    cta: "See hot cards",
    accent: "#ffcb05",
  },
  {
    title: "Binder",
    description: "Track value, cost basis and performance.",
    href: "/portfolio",
    cta: "Open binder",
    accent: "#42d77d",
  },
];

export default async function Home() {
  const featuredCards = await getLivePreviewCards(MARKET_PICKS_LIMIT);

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

          <HeroCardPoster initialCards={featuredCards} />
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
        <MarketPicksGrid initialCards={featuredCards} />
      </section>

      <section className="basecamp-content-section space-y-6 sm:space-y-7">
        <div className="space-y-2">
          <h2 className="basecamp-section-title">Trainer Modules</h2>
        </div>
        <div className="grid gap-4 sm:gap-5 md:grid-cols-3">
          {pillars.map((pillar, index) => (
            <Link
              key={pillar.title}
              href={pillar.href}
              className="basecamp-module-card group flex flex-col rounded-2xl p-5 transition duration-200 hover:-translate-y-1 sm:p-6"
            >
              <span
                className="basecamp-module-index"
                style={{
                  borderColor: `${pillar.accent}55`,
                  background: `${pillar.accent}14`,
                  color: pillar.accent,
                }}
              >
                0{index + 1}
              </span>
              <h3 className="text-xl font-semibold text-white">{pillar.title}</h3>
              <p className="section-copy mt-2 text-sm">{pillar.description}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-slate-200 transition-colors group-hover:text-white">
                {pillar.cta}
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

    </main>
  );
}
