import Link from "next/link";

import { CountUp } from "@/components/fx/count-up";
import { Reveal } from "@/components/fx/reveal";
import { HeroCardPoster } from "@/components/home/hero-card-poster";
import { MarketPicksGrid } from "@/components/home/market-picks-grid";
import { getLivePreviewCards, MARKET_PICKS_LIMIT } from "@/lib/preview-cards";

export const revalidate = 1800;

const modules = [
  {
    title: "Card Dex",
    description: "Search and catch any card by name, set, number or language.",
    href: "/search",
    cta: "Open the Dex",
    type: "water",
    glyph: "🔍",
  },
  {
    title: "Poké Market",
    description: "Live raw, graded and sold prices with confidence on every card.",
    href: "/search?sort=price-desc",
    cta: "See hot cards",
    type: "fire",
    glyph: "🔥",
  },
  {
    title: "Binder",
    description: "Track your collection's value, cost basis and performance.",
    href: "/portfolio",
    cta: "Open binder",
    type: "grass",
    glyph: "📒",
  },
] as const;

const heroChips = [
  { label: "Live pricing", type: "fire" },
  { label: "PSA pop", type: "psychic" },
  { label: "Sold comps", type: "water" },
  { label: "Scan to catch", type: "grass" },
  { label: "Any currency", type: "electric" },
];

const stats = [
  { label: "Sets indexed", value: 180, suffix: "+", type: "fire" },
  { label: "Years covered", value: 27, suffix: "", type: "water" },
  { label: "Languages", value: 9, suffix: "", type: "grass" },
  { label: "Price sources", value: 5, suffix: "", type: "electric" },
] as const;

export default async function Home() {
  const featuredCards = await getLivePreviewCards(MARKET_PICKS_LIMIT);

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <Reveal variant="pop">
        <section className="poke-hero poke-frame relative overflow-hidden">
          <span className="poke-hero-cloud poke-hero-cloud--a" aria-hidden="true" />
          <span className="poke-hero-cloud poke-hero-cloud--b" aria-hidden="true" />
          <span className="poke-hero-ball" aria-hidden="true" />

          <div className="relative z-10 grid gap-8 p-5 sm:p-9 lg:grid-cols-[1.05fr_0.82fr] lg:items-center lg:gap-12 lg:p-12">
            <div className="poke-hero-copy max-w-3xl space-y-5 lg:space-y-6">
              <span className="poke-badge">
                <span className="poke-badge-ball" aria-hidden="true" />
                Gotta price &rsquo;em all
              </span>
              <h1 className="poke-hero-title">
                <span className="poke-wordmark-xl">PokéDex</span>
                <span className="poke-hero-title-sub">Trainer Card Lab</span>
              </h1>
              <p className="poke-subline max-w-xl">
                Search every card, check live market prices, and grow your binder — your
                whole collection journey, one friendly Pokédex.
              </p>
              <div className="flex flex-wrap gap-2 max-sm:justify-center">
                {heroChips.map((chip) => (
                  <span key={chip.label} className="poke-chip" data-type={chip.type}>
                    {chip.label}
                  </span>
                ))}
              </div>
              <div className="hero-actions flex flex-wrap gap-3 pt-1 sm:gap-4">
                <Link href="/search" className="poke-btn poke-btn--red flex-1 sm:flex-none">
                  <span className="poke-btn-ball" aria-hidden="true" />
                  Open Card Dex
                </Link>
                <Link href="/portfolio" className="poke-btn poke-btn--blue flex-1 sm:flex-none">
                  View Binder
                </Link>
              </div>
            </div>

            <HeroCardPoster initialCards={featuredCards} />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="poke-stat-strip grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="poke-stat-card" data-type={stat.type}>
              <span className="poke-stat-ball" aria-hidden="true" />
              <CountUp value={stat.value} suffix={stat.suffix} className="poke-stat-value tabular-nums" />
              <span className="poke-stat-label">{stat.label}</span>
            </div>
          ))}
        </section>
      </Reveal>

      <Reveal>
        <section className="space-y-6 sm:space-y-7">
          <div className="poke-section-head flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <h2 className="poke-section-title">
              <span className="poke-section-ball" aria-hidden="true" />
              Hot Picks
            </h2>
            <Link href="/search" className="poke-pill">
              Open Card Dex →
            </Link>
          </div>
          <MarketPicksGrid initialCards={featuredCards} />
        </section>
      </Reveal>

      <Reveal>
        <section className="space-y-6 sm:space-y-7">
          <h2 className="poke-section-title">
            <span className="poke-section-ball" aria-hidden="true" />
            Trainer Menu
          </h2>
          <div className="grid gap-4 sm:gap-5 md:grid-cols-3">
            {modules.map((mod) => (
              <Link key={mod.title} href={mod.href} className="poke-module group" data-type={mod.type}>
                <span className="poke-module-glyph" aria-hidden="true">
                  {mod.glyph}
                </span>
                <h3 className="poke-module-title">{mod.title}</h3>
                <p className="poke-module-desc">{mod.description}</p>
                <span className="poke-module-cta">
                  {mod.cta}
                  <span aria-hidden className="transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </span>
                <span className="poke-module-shine" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </Reveal>
    </main>
  );
}
