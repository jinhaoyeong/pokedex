import Link from "next/link";

import { CountUp } from "@/components/fx/count-up";
import { Reveal } from "@/components/fx/reveal";
import { CardMarquee } from "@/components/home/card-marquee";
import { HeroCardPoster } from "@/components/home/hero-card-poster";
import { MarketPicksGrid } from "@/components/home/market-picks-grid";
import { BinderIcon, DexIcon, MarketIcon } from "@/components/icons/poke-icons";
import { getLivePreviewCards, MARKET_PICKS_LIMIT } from "@/lib/preview-cards";

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
  const featuredCards = await getLivePreviewCards(MARKET_PICKS_LIMIT);

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-6xl flex-col">
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="eyebrow-dot" aria-hidden="true" />
              The Pokémon TCG terminal
            </span>
            <h1 className="hero-title">
              Every card,
              <br />
              priced and
              <br />
              <em>collected.</em>
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

          <div className="hero-stage">
            <HeroCardPoster initialCards={featuredCards} />
          </div>
        </div>
      </section>

      <Reveal variant="fade">
        <CardMarquee cards={featuredCards} />
      </Reveal>

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

      <Reveal>
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">
                <span className="eyebrow-dot" aria-hidden="true" />
                The workspace
              </span>
              <h2 className="section-title">Three tools, one flow</h2>
            </div>
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
    </main>
  );
}
