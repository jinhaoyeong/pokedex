import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PortfolioClient } from "@/components/portfolio/portfolio-client";
import { getFeaturedCards } from "@/lib/cards";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default function PortfolioPage() {
  const heroCards = getFeaturedCards(3);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <section className="binder-hero relative overflow-hidden p-5 sm:p-8 lg:p-10">
        <div className="relative z-10 grid gap-8 lg:grid-cols-[1fr_24rem] lg:items-center">
          <div className="space-y-4 lg:pr-4">
            <span className="premium-kicker">
              Binder vault
            </span>
            <h1 className="section-title max-w-4xl text-4xl leading-tight sm:text-5xl lg:text-6xl">
              Track your Pokemon card value.
            </h1>
            <p className="section-copy max-w-3xl">
              Save raw or graded cards, cost paid, and live portfolio value in one binder.
            </p>
          </div>
          <div className="hero-card-poster relative mx-auto hidden w-full max-w-md lg:mx-0 lg:ml-auto lg:block">
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
