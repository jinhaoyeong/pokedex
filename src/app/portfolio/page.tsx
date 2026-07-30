import type { Metadata } from "next";
import Link from "next/link";

import { DesignComparisonDock } from "@/components/design-comparison-dock";
import { BinderHeroCards } from "@/components/portfolio/binder-hero-cards";
import { PortfolioClient } from "@/components/portfolio/portfolio-client";
import { getStaticMarketPool } from "@/lib/preview-cards";

export const metadata: Metadata = {
  title: "Portfolio",
};

export const dynamic = "force-dynamic";

const binderChanges = [
  "The title and Add Cards action now lead on mobile.",
  "Sort and grade controls are condensed into labeled menus.",
  "Holdings stay primary while analytics open on demand.",
  "Card rows use clean link and action semantics.",
  "Delete and clear actions now confirm and offer recovery.",
] as const;

function isClerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

export default async function PortfolioPage() {
  // Bundled static pool only — never block binder on live Pokemon TCG / DB search.
  const heroPool = getStaticMarketPool();
  const clerkConfigured = isClerkConfigured();

  return (
    <main className="app-main portfolio-page-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="binder-hero route-hero relative p-4 sm:p-10 lg:p-12">
        <div className="binder-hero-grid relative z-10 grid gap-3 sm:gap-6 lg:grid-cols-[1.02fr_0.8fr] lg:items-center lg:gap-10">
          <div className="binder-hero-copy max-w-3xl space-y-3 sm:space-y-5 lg:space-y-6">
            <span className="premium-kicker surface-original-only max-sm:w-full max-sm:justify-center">
              Binder vault
            </span>
            <div>
              <h1 className="section-title pokemon-display-title binder-hero-title surface-original-only mb-2 max-w-4xl text-[1.8rem] text-white sm:mb-5 sm:text-6xl">
                Track your Pokemon card value
              </h1>
              <h1 className="section-title pokemon-display-title binder-hero-title surface-improved-only mb-2 max-w-4xl text-[2rem] text-white sm:mb-5 sm:text-6xl">
                Your collection, at a glance.
              </h1>
            </div>
            <p className="hero-subline binder-hero-subline surface-original-only max-w-xl">
              Keep raw cards, graded slabs, cost basis, market movement, and portfolio
              performance together in one clean binder view.
            </p>
            <p className="hero-subline binder-hero-subline surface-improved-only max-w-xl">
              See what you own, what it is worth, and what changed—then update a holding without
              leaving the ledger.
            </p>
            <p className="binder-storage-note surface-improved-only">
              {clerkConfigured ? "Account sync available" : "Stored on this device"} · Export anytime
            </p>
            <div className="binder-hero-actions flex flex-wrap gap-3 pt-1 sm:gap-4 sm:pt-0">
              <Link href="/search" className="btn btn-primary flex-1 sm:flex-none">
                Add Cards
              </Link>
              {clerkConfigured ? (
                <Link href="/portfolio/vault" className="btn btn-ghost flex-1 sm:flex-none">
                  Cloud Vault
                </Link>
              ) : null}
            </div>
          </div>
          <div className="hero-card-poster relative mx-auto w-full max-w-md lg:order-last lg:mx-0 lg:ml-auto">
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
              <strong>{clerkConfigured ? "Binder + Account Sync" : "Local Binder"}</strong>
            </div>
          </div>
        </div>
      </section>

      <PortfolioClient />
      <DesignComparisonDock surface="Binder" changes={binderChanges} />
    </main>
  );
}
