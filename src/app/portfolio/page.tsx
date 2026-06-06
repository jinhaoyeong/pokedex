import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PortfolioClient } from "@/components/portfolio/portfolio-client";
import { getFeaturedCards } from "@/lib/cards";
import { searchLiveCards } from "@/lib/pokemon-tcg-api";
import type { TcgCard } from "@/types/pokemon";

export const metadata: Metadata = {
  title: "Portfolio",
};

export const revalidate = 3600;

async function getPortfolioHeroCards(limit = 3): Promise<TcgCard[]> {
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
    // Keep the binder preview usable if the live catalog is temporarily unavailable.
  }

  return getFeaturedCards(limit);
}

export default async function PortfolioPage() {
  const heroCards = await getPortfolioHeroCards(3);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-2.5 py-3 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <section className="binder-hero route-hero relative overflow-hidden border-2 border-yellow-200/60 p-3 sm:p-8 lg:p-10">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />

        <div className="relative z-10 grid gap-5 lg:grid-cols-[1.02fr_0.8fr] lg:items-center lg:gap-8">
          <div className="max-w-3xl space-y-4 lg:space-y-6">
            <span className="premium-kicker max-sm:w-full max-sm:justify-center">
              Binder vault
            </span>
            <div className="space-y-3 sm:space-y-4">
              <h1 className="section-title mb-3 max-w-4xl text-[1.8rem] text-white sm:mb-5 sm:text-6xl">
                Track your Pokemon card value.
              </h1>
              <p className="premium-hero-copy max-w-2xl p-3 text-[0.84rem] font-black leading-6 sm:p-4 sm:text-base sm:leading-7">
                Save raw or graded cards, cost paid, and live portfolio value in one binder.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 text-[0.68rem] font-black uppercase tracking-[0.1em] sm:text-xs sm:tracking-[0.12em]">
              <span className="premium-chip">Cost basis</span>
              <span className="premium-chip">Live value</span>
              <span className="premium-chip">P/L tracking</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1 sm:gap-3 sm:pt-0">
              <Link
                href="/search"
                className="trainer-button flex-1 bg-blue-500 px-4 py-2.5 text-center text-sm font-black text-white sm:flex-none sm:px-5 sm:py-3"
              >
                Add Cards
              </Link>
              <Link
                href="/"
                className="pixel-secondary-button flex-1 px-4 py-2.5 text-center text-sm font-black sm:flex-none sm:px-5 sm:py-3"
              >
                Main Page
              </Link>
            </div>
          </div>
          <div className="hero-card-poster relative order-first mx-auto w-full max-w-md lg:order-last lg:mx-0 lg:ml-auto">
            <div className="hero-card-glow" />
            <div className="hero-card-stage">
              <div className="hero-stage-header">
                <span>Binder Preview</span>
                <strong>Portfolio Picks</strong>
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
                    sizes="360px"
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
              <span>Tracked Cards</span>
              <strong>Binder Ready</strong>
            </div>
          </div>
        </div>
      </section>

      <PortfolioClient />
    </main>
  );
}
