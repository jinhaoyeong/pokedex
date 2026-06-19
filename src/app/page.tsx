import Link from "next/link";

import { CountUp } from "@/components/fx/count-up";
import { DecodeText } from "@/components/fx/decode-text";
import { Reveal } from "@/components/fx/reveal";
import { HeroCardPoster } from "@/components/home/hero-card-poster";
import { MarketPicksGrid } from "@/components/home/market-picks-grid";
import { getLivePreviewCards, MARKET_PICKS_LIMIT } from "@/lib/preview-cards";

export const revalidate = 1800;

const modules = [
  {
    title: "Card Dex",
    code: "DEX-01",
    description: "Scan & search 25+ years of cards by name, set, number or language.",
    href: "/search",
    cta: "Open scanner",
    accent: "#42a5ff",
    glyph: "🔍",
  },
  {
    title: "Market",
    code: "DEX-02",
    description: "Raw, graded, sold comps and confidence — one live signal feed.",
    href: "/search?sort=price-desc",
    cta: "See hot cards",
    accent: "#ffcb05",
    glyph: "📈",
  },
  {
    title: "Binder",
    code: "DEX-03",
    description: "Track value, cost basis and performance like a real portfolio.",
    href: "/portfolio",
    cta: "Open binder",
    accent: "#42d77d",
    glyph: "📒",
  },
] as const;

const heroChips = ["Live pricing", "PSA pop", "Sold comps", "Scan-to-find", "Multi-currency"];

const stats = [
  { label: "Sets indexed", value: 180, suffix: "+" },
  { label: "Years covered", value: 27, suffix: "" },
  { label: "Languages", value: 9, suffix: "" },
  { label: "Data sources", value: 5, suffix: "" },
] as const;

export default async function Home() {
  const featuredCards = await getLivePreviewCards(MARKET_PICKS_LIMIT);

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <Reveal variant="boot">
        <section className="dex-screen dex-hero relative overflow-hidden">
          <span className="dex-bracket dex-bracket--tl" aria-hidden="true" />
          <span className="dex-bracket dex-bracket--tr" aria-hidden="true" />
          <span className="dex-bracket dex-bracket--bl" aria-hidden="true" />
          <span className="dex-bracket dex-bracket--br" aria-hidden="true" />
          <span className="dex-scan-sweep" aria-hidden="true" />

          <div className="dex-hud-bar">
            <span className="dex-hud-tag">
              <i className="dex-hud-live" /> SYSTEM ONLINE
            </span>
            <span className="dex-hud-mono">POKéDEX OS · v3.0</span>
            <span className="dex-hud-mono dex-hud-signal">SIGNAL ▓▓▓▓░</span>
          </div>

          <div className="relative z-10 grid gap-8 p-5 sm:p-9 lg:grid-cols-[1.05fr_0.82fr] lg:items-center lg:gap-12 lg:p-12">
            <div className="dex-hero-copy max-w-3xl space-y-5 lg:space-y-6">
              <span className="dex-kicker">⚡ TCG market terminal</span>
              <DecodeText
                as="h1"
                text="PokéDex OS"
                className="dex-hero-title block"
              />
              <p className="dex-subline max-w-xl">
                Scan cards, read live market signals, and command your binder from one
                cinematic Pokédex terminal built for serious collectors.
              </p>
              <div className="flex flex-wrap gap-2 max-sm:justify-center">
                {heroChips.map((chip) => (
                  <span key={chip} className="dex-chip">
                    {chip}
                  </span>
                ))}
              </div>
              <div className="hero-actions flex flex-wrap gap-3 pt-1 sm:gap-4">
                <Link href="/search" className="dex-btn dex-btn--primary flex-1 sm:flex-none">
                  ▸ Open Card Dex
                </Link>
                <Link href="/portfolio" className="dex-btn dex-btn--ghost flex-1 sm:flex-none">
                  View Binder
                </Link>
              </div>
              <div className="dex-readout">
                {stats.map((stat) => (
                  <span key={stat.label} className="dex-readout-item">
                    <b>
                      {stat.value}
                      {stat.suffix}
                    </b>
                    {stat.label}
                  </span>
                ))}
              </div>
            </div>

            <HeroCardPoster initialCards={featuredCards} />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="dex-stat-strip grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="dex-stat-card">
              <span className="dex-stat-spark" aria-hidden="true" />
              <CountUp value={stat.value} suffix={stat.suffix} className="dex-stat-value tabular-nums" />
              <span className="dex-stat-label">{stat.label}</span>
            </div>
          ))}
        </section>
      </Reveal>

      <Reveal>
        <section className="space-y-6 sm:space-y-7">
          <div className="dex-panel-head flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="dex-panel-kicker">▸ Live feed</span>
              <h2 className="dex-section-title">Hot Scans</h2>
            </div>
            <Link href="/search" className="dex-link-pill">
              Open Card Dex →
            </Link>
          </div>
          <MarketPicksGrid initialCards={featuredCards} />
        </section>
      </Reveal>

      <Reveal>
        <section className="space-y-6 sm:space-y-7">
          <div className="dex-panel-head">
            <span className="dex-panel-kicker">▸ Functions</span>
            <h2 className="dex-section-title">Trainer Modules</h2>
          </div>
          <div className="grid gap-4 sm:gap-5 md:grid-cols-3">
            {modules.map((mod) => (
              <Link
                key={mod.title}
                href={mod.href}
                className="dex-module group"
                style={{ ["--accent" as string]: mod.accent }}
              >
                <div className="dex-module-top">
                  <span className="dex-module-code">{mod.code}</span>
                  <span aria-hidden className="dex-module-glyph">
                    {mod.glyph}
                  </span>
                </div>
                <h3 className="dex-module-title">{mod.title}</h3>
                <p className="dex-module-desc">{mod.description}</p>
                <span className="dex-module-cta">
                  {mod.cta}
                  <span aria-hidden className="transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </span>
                <span className="dex-module-glow" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </Reveal>
    </main>
  );
}
