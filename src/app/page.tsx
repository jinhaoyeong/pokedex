import Link from "next/link";

import { CountUp } from "@/components/fx/count-up";
import { Reveal } from "@/components/fx/reveal";
import { HeroCardPoster } from "@/components/home/hero-card-poster";
import { MarketPicksGrid } from "@/components/home/market-picks-grid";
import {
  BinderIcon,
  DexIcon,
  MarketIcon,
  SparkleIcon,
  StylusIcon,
} from "@/components/icons/poke-icons";
import { getLivePreviewCards, MARKET_PICKS_LIMIT } from "@/lib/preview-cards";

export const revalidate = 1800;

const modules = [
  {
    title: "Card Dex",
    description: "Search and catch any card by name, set, number or language.",
    href: "/search",
    cta: "Open the Dex",
    type: "water",
    Icon: DexIcon,
  },
  {
    title: "Poké Market",
    description: "Live raw, graded and sold prices with confidence on every card.",
    href: "/search?sort=price-desc",
    cta: "See hot cards",
    type: "fire",
    Icon: MarketIcon,
  },
  {
    title: "Binder",
    description: "Track your collection's value, cost basis and performance.",
    href: "/portfolio",
    cta: "Open binder",
    type: "grass",
    Icon: BinderIcon,
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
        <section className="ds-device" aria-label="PokéDex handheld">
          <div className="ds-shell">
            {/* Top screen — the display */}
            <div className="ds-screen ds-screen--top">
              <span className="ds-glare" aria-hidden="true" />
              <span className="ds-cloud ds-cloud--a" aria-hidden="true" />
              <span className="ds-cloud ds-cloud--b" aria-hidden="true" />
              <div className="ds-top-grid">
                <div className="ds-top-copy">
                  <span className="poke-badge">
                    <span className="poke-badge-ball" aria-hidden="true" />
                    Gotta price &rsquo;em all
                  </span>
                  <h1 className="poke-hero-title">
                    <span className="poke-wordmark-xl">PokéDex</span>
                    <span className="poke-hero-title-sub">Trainer Card Lab</span>
                  </h1>
                  <p className="poke-subline">
                    Search every card, check live market prices, and grow your binder —
                    your whole collection journey in one handheld Pokédex.
                  </p>
                </div>
                <HeroCardPoster initialCards={featuredCards} />
              </div>
            </div>

            {/* Hinge */}
            <div className="ds-hinge" aria-hidden="true">
              <span className="ds-led" />
              <span className="ds-hinge-line" />
              <span className="ds-speaker">
                <i /> <i /> <i />
              </span>
            </div>

            {/* Bottom screen — the touch menu */}
            <div className="ds-screen ds-screen--bottom">
              <span className="ds-glare" aria-hidden="true" />
              <div className="ds-menu">
                <div className="ds-menu-head">
                  <SparkleIcon className="ds-menu-head-icon" aria-hidden="true" />
                  <span>Touch Menu</span>
                </div>
                <div className="ds-menu-actions">
                  <Link href="/search" className="poke-btn poke-btn--red">
                    <span className="poke-btn-ball" aria-hidden="true" />
                    Open Card Dex
                  </Link>
                  <Link href="/portfolio" className="poke-btn poke-btn--blue">
                    View Binder
                  </Link>
                </div>
                <div className="ds-chip-row">
                  {heroChips.map((chip) => (
                    <span key={chip.label} className="poke-chip" data-type={chip.type}>
                      {chip.label}
                    </span>
                  ))}
                </div>
                <span className="ds-stylus">
                  <StylusIcon className="ds-stylus-icon" aria-hidden="true" />
                  Tap an option to begin
                </span>
              </div>
            </div>
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
                  <mod.Icon className="poke-module-icon" />
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
