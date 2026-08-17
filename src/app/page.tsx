import Link from "next/link";

import { CountUp } from "@/components/fx/count-up";
import { Reveal } from "@/components/fx/reveal";
import { CardMarquee } from "@/components/home/card-marquee";
import { HeroScene } from "@/components/home/hero-scene";
import { HeroShowcase } from "@/components/home/hero-showcase";
import { MarketPicksGrid } from "@/components/home/market-picks-grid";
import { SiteFooter } from "@/components/site-footer";
import {
  getStaticMarketPool,
  selectTodaysPicks,
  shuffleMarqueeCards,
} from "@/lib/preview-cards";

// Hero fan shows the top few highest-value cards.
const HERO_FAN_SIZE = 5;

export const dynamic = "force-dynamic";

const pillars = [
  {
    title: "Card Dex",
    description: "Search by name, set, number, or language.",
    href: "/search",
    cta: "Open the Dex",
  },
  {
    title: "Market",
    description:
      "Raw, graded and sold-comp pricing with confidence and freshness across English, Japanese, and Chinese cards.",
    href: "/search?sort=price-desc",
    cta: "View the market",
  },
  {
    title: "Binder",
    description: "Track value, cost basis and performance.",
    href: "/portfolio",
    cta: "Open your binder",
  },
] as const;

const stats = [
  { label: "Sets indexed", value: 180, suffix: "+" },
  { label: "Years covered", value: 27, suffix: "" },
  { label: "Languages", value: 3, suffix: "" },
  { label: "Price sources", value: 5, suffix: "" },
] as const;

export default function Home() {
  // First paint must never wait on live market/API discovery. Render a bundled,
  // well-formed card pool immediately; the client boot warmup refreshes preview
  // data after the app shell is interactive.
  const marketPool = getStaticMarketPool();
  const heroCards = marketPool.slice(0, HERO_FAN_SIZE);
  const marqueeCards = shuffleMarqueeCards(marketPool);
  const todaysPicks = selectTodaysPicks(marketPool);

  return (
    <>
      <main className="app-main home-main mx-auto flex min-h-screen w-full max-w-6xl flex-col">
        {/* HERO — centered, with a full-width visual beneath. HeroScene makes the
            whole block recede (shrink + drift up) as you scroll. */}
        <section className="hero hero--centered">
          <HeroScene>
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
              <HeroShowcase initialCards={heroCards} />
            </Reveal>
          </HeroScene>
        </section>

        {/* MOVING IMAGERY — sits below the fold on desktop; its own scroll-linked
            unroll (in CardMarquee) reveals it, so no Reveal wrapper here. */}
        <CardMarquee cards={marqueeCards} />

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
            {/* Editorial index (nor.ma-style): full-width rows under hairline
                dividers — mono index, oversized title, quiet description, and
                an arrowed CTA. No boxes, no icon chips; type reads as design. */}
            <div className="feature-index">
              {modules.map((mod, index) => (
                <Reveal key={mod.title} delay={index * 90}>
                  <Link href={mod.href} className="feature-row group">
                    <span className="feature-row-no" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="feature-row-title">{mod.title}</h3>
                    <p className="feature-row-desc">{mod.description}</p>
                    <span className="feature-row-cta">
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
            <MarketPicksGrid initialCards={todaysPicks} />
          </section>
        </Reveal>

        {/* CLOSING CTA */}
        <Reveal>
          {/* Editorial closing statement (nor.ma-style): no panel — a hairline,
              a huge left-set title, and the lede + actions in a facing column. */}
          <section className="cta-band">
            <div className="cta-copy">
              <span className="eyebrow">
                <span className="eyebrow-dot" aria-hidden="true" />
                Start collecting smarter
              </span>
              <h2 className="cta-title">Your binder, finally measured.</h2>
            </div>
            <div className="cta-side">
              <p className="cta-lede">
                Open the Dex, scan a card, and watch the numbers fall into place.
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
          </section>
        </Reveal>
      </main>

      <SiteFooter />
    </>
  );
}
