import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PortfolioClient } from "@/components/portfolio/portfolio-client";
import { getLivePreviewCards } from "@/lib/preview-cards";

export const metadata: Metadata = {
  title: "Portfolio",
};

export const revalidate = 3600;

export default async function PortfolioPage() {
  const heroCards = await getLivePreviewCards(3);

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="binder-hero route-hero relative overflow-hidden p-5 sm:p-10 lg:p-12">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />

        <div className="relative z-10 grid gap-8 lg:grid-cols-[1.02fr_0.8fr] lg:items-center lg:gap-10">
          <div className="binder-hero-copy max-w-3xl space-y-5 lg:space-y-6">
            <span className="premium-kicker max-sm:w-full max-sm:justify-center">
              Binder vault
            </span>
            <div>
              <h1 className="section-title pokemon-display-title binder-hero-title mb-3 max-w-4xl text-[1.8rem] text-white sm:mb-5 sm:text-6xl">
                Track your Pokemon card value
              </h1>
            </div>
            <p className="hero-subline binder-hero-subline max-w-xl">
              Keep raw cards, graded slabs, cost basis, market movement, and portfolio performance together in one clean binder view.
            </p>
            <div className="binder-hero-actions flex flex-wrap gap-3 pt-1 sm:gap-4 sm:pt-0">
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
