import type { Metadata } from "next";
import Link from "next/link";

import { BinderHeroCards } from "@/components/portfolio/binder-hero-cards";
import { PortfolioClient } from "@/components/portfolio/portfolio-client";
import { getMarketPickPool } from "@/lib/preview-cards";

export const metadata: Metadata = {
  title: "Portfolio",
};

export const revalidate = 3600;

export default async function PortfolioPage() {
  const heroPool = await getMarketPickPool();

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="binder-hero route-hero relative overflow-hidden p-4 sm:p-10 lg:p-12">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />

        <div className="binder-hero-grid relative z-10 grid gap-3 sm:gap-6 lg:grid-cols-[1.02fr_0.8fr] lg:items-center lg:gap-10">
          <div className="binder-hero-copy max-w-3xl space-y-3 sm:space-y-5 lg:space-y-6">
            <span className="premium-kicker max-sm:w-full max-sm:justify-center">
              Binder vault
            </span>
            <div>
              <h1 className="section-title pokemon-display-title binder-hero-title mb-2 max-w-4xl text-[1.8rem] text-white sm:mb-5 sm:text-6xl">
                Track your Pokemon card value
              </h1>
            </div>
            <p className="hero-subline binder-hero-subline max-w-xl">
              Keep raw cards, graded slabs, cost basis, market movement, and portfolio performance together in one clean binder view.
            </p>
            <div className="binder-hero-actions flex flex-wrap gap-3 pt-1 sm:gap-4 sm:pt-0">
              <Link
                href="/search"
                className="btn btn-primary flex-1 sm:flex-none"
              >
                Add Cards
              </Link>
              <Link
                href="/"
                className="btn btn-ghost flex-1 sm:flex-none"
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
              <BinderHeroCards cards={heroPool} />
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
