import Link from "next/link";

import { CountUp } from "@/components/fx/count-up";
import { Reveal } from "@/components/fx/reveal";
import { CardMarquee } from "@/components/home/card-marquee";
import { HeroShowcase } from "@/components/home/hero-showcase";
import { MarketPicksGrid } from "@/components/home/market-picks-grid";
import { BinderIcon, DexIcon, MarketIcon } from "@/components/icons/poke-icons";
import { SiteFooter } from "@/components/site-footer";
import { getLivePreviewCards } from "@/lib/preview-cards";

// The hero fan shows up to 5 cards and the marquee repeats a wider pool, so
// pull more than the 3 used by the picks grid (which slices itself back down).
const PREVIEW_POOL_SIZE = 10;

export const revalidate = 1800;

const modules = [
  {
    title: "Card Dex",
    description:
      "Search 25+ years of cards by name, set, number or language — with scan-to-find for the ones you can't name.",
    href: "/search",
    cta: "Open the Dex",
    Icon: DexIcon,
  },
  {
    title: "Market",
    description:
      "Raw, graded and sold-comp pricing with confidence and freshness on every figure, across nine languages.",
    href: "/search?sort=price-desc",
    cta: "View the market",
    Icon: MarketIcon,
  },
  {
    title: "Binder",
    description:
      "Track value, cost basis and performance like a real portfolio — diversity, rank and standout holdings.",
    href: "/portfolio",
    cta: "Open your binder",
    Icon: BinderIcon,
  },
] as const;

const stats = [
  { label: "Sets indexed", value: 180, suffix: "+" },
  { label: "Years covered", value: 27, suffix: "" },
  { label: "Languages", value: 9, suffix: "" },
  { label: "Price sources", value: 5, suffix: "" },
] as const;

export default async function Home() {
  const featuredCards = await getLivePreviewCards(PREVIEW_POOL_SIZE);

  return (
    <>
      <main className="app-main home-main mx-auto flex min-h-screen w-full max-w-6xl flex-col">
        {/* HERO — centered, with a full-width visual beneath */}
        <section className="hero hero--centered">
          <div className="hero-inner">
            <span className="eyebrow">
              <span className="eyebrow-dot" aria-hidden="true" />
              The Pokémon TCG terminal
            </span>
            <h1 className="hero-title">
              Every card,
              <br />
              priced and <em>collected.</em>
            </h1>
            <p className="hero-lede">
              Search the entire Pokémon card universe, read live market signals you can trust,
              and grow your binder — in one quiet, considered workspace.
            </p>
            <div className="hero-actions">
              <Link href="/search" className="btn btn-primary">
                Open Card Dex
              </Link>
              <Link href="/portfolio" className="btn btn-ghost">
                View Binder
              </Link>
            </div>
          </div>

          <Reveal variant="fade" className="hero-visual">
            <HeroShowcase initialCards={featuredCards} />
          </Reveal>
        </section>

        {/* MOVING IMAGERY */}
        <Reveal variant="fade">
          <CardMarquee cards={featuredCards} />
        </Reveal>

        {/* CAPABILITIES */}
        <Reveal>
          <section className="band">
            <div className="band-head">
              <span className="eyebrow">
                <span className="eyebrow-dot" aria-hidden="true" />
                The workspace
              </span>
              <h2 className="band-title">Three tools, one quiet flow</h2>
              <p className="band-lede">
                Everything a collector needs to find, value and hold the right cards —
                without the noise of a marketplace.
              </p>
            </div>
            <div className="feature-grid">
              {modules.map((mod, index) => (
                <Reveal key={mod.title} delay={index * 90}>
                  <Link href={mod.href} className="feature-card group">
                    <span className="feature-icon">
                      <mod.Icon className="feature-icon-svg" />
                    </span>
                    <h3 className="feature-title">{mod.title}</h3>
                    <p className="feature-desc">{mod.description}</p>
                    <span className="feature-link">
                      {mod.cta}
                      <span aria-hidden className="link-arrow">→</span>
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </section>
        </Reveal>

        {/* PROOF */}
        <Reveal>
          <section className="stat-row">
            {stats.map((stat) => (
              <div key={stat.label} className="stat">
                <CountUp value={stat.value} suffix={stat.suffix} className="stat-value tabular-nums" />
                <span className="stat-label">{stat.label}</span>
              </div>
            ))}
          </section>
        </Reveal>

        {/* PICKS */}
        <Reveal>
          <section className="section">
            <div className="section-head">
              <div>
                <span className="eyebrow">
                  <span className="eyebrow-dot" aria-hidden="true" />
                  Live feed
                </span>
                <h2 className="section-title">Today&rsquo;s picks</h2>
              </div>
              <Link href="/search" className="text-link">
                Browse all cards
                <span aria-hidden className="link-arrow">→</span>
              </Link>
            </div>
            <MarketPicksGrid initialCards={featuredCards} />
          </section>
        </Reveal>

        {/* CLOSING CTA */}
        <Reveal>
          <section className="cta-band">
            <span className="eyebrow eyebrow--center">
              <span className="eyebrow-dot" aria-hidden="true" />
              Start collecting smarter
            </span>
            <h2 className="cta-title">Your binder, finally measured.</h2>
            <p className="cta-lede">
              Open the Dex, scan a card, and watch the numbers fall into place.
            </p>
            <div className="hero-actions hero-actions--center">
              <Link href="/search" className="btn btn-primary">
                Open Card Dex
              </Link>
              <Link href="/portfolio" className="btn btn-ghost">
                View Binder
              </Link>
            </div>
          </section>
        </Reveal>
      </main>

      <SiteFooter />
    </>
  );
}
