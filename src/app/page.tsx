import Link from "next/link";

import { CountUp } from "@/components/fx/count-up";
import { Reveal } from "@/components/fx/reveal";
import { CardMarquee } from "@/components/home/card-marquee";
import { HomeComparisonDock } from "@/components/home/home-comparison-dock";
import { HeroScene } from "@/components/home/hero-scene";
import { HeroShowcase } from "@/components/home/hero-showcase";
import { MarketPicksGrid } from "@/components/home/market-picks-grid";
import { LazyScanButton } from "@/components/search/lazy-scan-button";
import { SiteFooter } from "@/components/site-footer";
import {
  getStaticMarketPool,
  selectTodaysPicks,
  shuffleMarqueeCards,
} from "@/lib/preview-cards";

// Hero fan shows the top few highest-value cards.
const HERO_FAN_SIZE = 5;

export const dynamic = "force-dynamic";

const modules = [
  {
    title: "Card Dex",
    description:
      "Search 25+ years of cards by name, set, number or language — with scan-to-find for the ones you can't name.",
    improvedDescription:
      "Find a card by its printed name, set, collector number, or language — or scan the card when you cannot name it.",
    href: "/search",
    cta: "Open the Dex",
  },
  {
    title: "Market",
    description:
      "Raw, graded and sold-comp pricing with confidence and freshness across English, Japanese, and Chinese cards.",
    improvedDescription:
      "Compare ungraded cards, professionally graded copies, and completed sales with source and freshness context.",
    href: "/search?sort=price-desc",
    cta: "View the market",
  },
  {
    title: "Binder",
    description:
      "Track value, cost basis and performance like a real portfolio — diversity, rank and standout holdings.",
    improvedDescription:
      "Record what you own and paid, then follow collection value, performance, and standout holdings in one binder.",
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
      <main className="app-main home-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
        {/* HERO — centered, with a full-width visual beneath. HeroScene makes the
            whole block recede (shrink + drift up) as you scroll. */}
        <section className="hero hero--centered">
          <HeroScene>
            <div className="hero-inner">
              <span className="eyebrow home-original-only">
                <span className="eyebrow-dot" aria-hidden="true" />
                The Pokémon TCG terminal
              </span>
              <h1 className="hero-title">
                Every card,
                <br />
                priced and <em>collected.</em>
              </h1>
              <p className="hero-lede home-original-only">
                Search the entire Pokémon card universe, read live market signals you can trust,
                and grow your binder — in one quiet, considered workspace.
              </p>
              <p className="hero-lede home-improved-only">
                Find any Pokémon card, check source-aware market snapshots, and build a binder
                that remembers what you paid.
              </p>
              <div className="hero-actions home-original-only">
                <Link href="/search" className="btn btn-primary">
                  Open Card Dex
                </Link>
                <Link href="/portfolio" className="btn btn-ghost">
                  View Binder
                </Link>
              </div>
              <div className="home-hero-launcher home-improved-only">
                <div className="home-launcher-panel">
                  <form action="/search" method="get" className="home-search-form" role="search">
                    <label htmlFor="home-card-search" className="sr-only">
                      Search by card name, set, or collector number
                    </label>
                    <span className="home-search-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                        <path
                          d="m16 16 4 4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <input
                      id="home-card-search"
                      name="q"
                      type="search"
                      enterKeyHint="search"
                      placeholder="Name, set, or collector number"
                      autoComplete="off"
                      aria-describedby="home-search-hint"
                    />
                    <button type="submit" className="btn btn-primary">
                      Search Dex
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </form>
                  <div className="home-launcher-secondary">
                    <div className="home-quick-actions">
                      <LazyScanButton />
                      <Link href="/portfolio" className="home-binder-link">
                        Open your binder
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Link>
                    </div>
                    <p id="home-search-hint" className="home-search-hint">
                      Try “Pikachu 25/25” or scan the card in your hand.
                    </p>
                  </div>
                </div>
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
                    <p className="feature-row-desc home-original-only">{mod.description}</p>
                    <p className="feature-row-desc home-improved-only">{mod.improvedDescription}</p>
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
                <CountUp
                  value={stat.value}
                  suffix={stat.suffix}
                  className="stat-value tabular-nums home-original-only"
                />
                <span className="stat-value tabular-nums home-improved-only">
                  {stat.value}{stat.suffix}
                </span>
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
                  <span className="home-original-only">Live feed</span>
                  <span className="home-improved-only">Market preview</span>
                </span>
                <h2 className="section-title">Today&rsquo;s picks</h2>
              </div>
              <Link href="/search" className="text-link">
                Browse all cards
                <span aria-hidden className="link-arrow">→</span>
              </Link>
            </div>
            <div className="market-trust home-improved-only">
              <div className="market-trust-status" aria-label="Market preview status">
                <span>Preview pricing</span>
                <span>Up to 5 public sources</span>
                <span>Refreshes after load</span>
              </div>
              <details className="market-trust-details">
                <summary>How pricing works</summary>
                <p>
                  These are directional market snapshots, not guaranteed sale prices. Availability
                  varies by card, language, condition, and grade; open a card to inspect the
                  available source and freshness details.
                </p>
              </details>
            </div>
            <MarketPicksGrid initialCards={todaysPicks} />
          </section>
        </Reveal>

        {/* CLOSING CTA */}
        <Reveal>
          {/* Editorial closing statement (nor.ma-style): no panel — a hairline,
              a huge left-set title, and the lede + actions in a facing column. */}
          <section className="cta-band">
            <div className="cta-copy home-original-only">
              <span className="eyebrow">
                <span className="eyebrow-dot" aria-hidden="true" />
                Start collecting smarter
              </span>
              <h2 className="cta-title">Your binder, finally measured.</h2>
            </div>
            <div className="cta-side home-original-only">
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
            <div className="cta-copy home-improved-only">
              <h2 className="cta-title">Start with one card.</h2>
            </div>
            <div className="cta-side home-improved-only">
              <p className="cta-lede">
                Record what you paid, follow what it is worth, and let your binder become a useful
                history of the collection you are building.
              </p>
              <Link href="/portfolio" className="btn btn-primary">
                Start your binder
                <span aria-hidden className="link-arrow">→</span>
              </Link>
            </div>
          </section>
        </Reveal>
      </main>

      <SiteFooter />
      <HomeComparisonDock />
    </>
  );
}
