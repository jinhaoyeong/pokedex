import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { HoloTilt } from "@/components/fx/holo-tilt";
import { BinderHeroCards } from "@/components/portfolio/binder-hero-cards";
import { PortfolioClient } from "@/components/portfolio/portfolio-client";
import {
  getCurrentBinderCards,
  isAccountBackendConfigured,
  type BinderCard,
} from "@/lib/account-db.server";
import { getMarketPickPool } from "@/lib/preview-cards";

export const metadata: Metadata = {
  title: "Portfolio",
};

export const dynamic = "force-dynamic";

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function unitPriceUsd(card: BinderCard) {
  const parsed = card.marketPrice ? Number.parseFloat(card.marketPrice) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function BinderDashboard({ cards }: { cards: BinderCard[] }) {
  const totalQuantity = cards.reduce((sum, card) => sum + card.quantity, 0);
  const notedCards = cards.filter((card) => card.notes?.trim()).length;
  const latestCard = cards[0];
  const totalMarketValue = cards.reduce(
    (sum, card) => sum + unitPriceUsd(card) * card.quantity,
    0,
  );
  const pricedCards = cards.filter((card) => unitPriceUsd(card) > 0);
  const priceCoveragePct = cards.length
    ? Math.round((pricedCards.length / cards.length) * 100)
    : 0;
  const topAsset = pricedCards.reduce<BinderCard | null>(
    (best, card) => (unitPriceUsd(card) > (best ? unitPriceUsd(best) : 0) ? card : best),
    null,
  );
  const topAssetHoldingUsd = topAsset ? unitPriceUsd(topAsset) * topAsset.quantity : 0;
  const topAssetSharePct =
    topAsset && totalMarketValue > 0
      ? Math.round((topAssetHoldingUsd / totalMarketValue) * 100)
      : 0;
  const avgCardValue = totalQuantity > 0 ? totalMarketValue / totalQuantity : 0;

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* ANALYTICS — portfolio-terminal register: mono tabular figures, trend
          glows, and a live meter per tile. Pure presentation over the same
          Supabase rows. */}
      <section className="binder-dashboard grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
        <div className="binder-stat-card" data-trend={totalMarketValue > 0 ? "up" : "flat"}>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)]">
            Market Value
          </p>
          <span className="stat-figure mt-3 block text-3xl font-semibold text-white">
            {formatUsd(totalMarketValue)}
          </span>
          <p className="binder-stat-sub mt-2">
            {formatUsd(avgCardValue)} avg / card &middot; live from Supabase
          </p>
          <div className="binder-meter mt-4">
            <span style={{ width: `${Math.min(Math.max(priceCoveragePct, 6), 100)}%` }} />
          </div>
          <p className="binder-stat-sub mt-2">{priceCoveragePct}% of holdings priced</p>
        </div>

        <div className="binder-stat-card" data-trend={topAsset ? "up" : "flat"}>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)]">
            Top Asset
          </p>
          {topAsset ? (
            <>
              <span className="stat-figure mt-3 block truncate text-xl font-semibold text-amber-300 sm:text-2xl">
                {topAsset.name}
              </span>
              <p className="binder-stat-sub mt-2">
                {formatUsd(unitPriceUsd(topAsset))} &times; {topAsset.quantity} ={" "}
                {formatUsd(topAssetHoldingUsd)}
              </p>
              <div className="binder-meter binder-meter--gold mt-4">
                <span style={{ width: `${Math.min(Math.max(topAssetSharePct, 4), 100)}%` }} />
              </div>
              <p className="binder-stat-sub mt-2">{topAssetSharePct}% of portfolio value</p>
            </>
          ) : (
            <>
              <span className="stat-figure mt-3 block text-2xl font-semibold text-white">—</span>
              <p className="binder-stat-sub mt-2">Prices pending for this vault</p>
            </>
          )}
        </div>

        <div className="binder-stat-card" data-trend="up">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)]">
            Total Qty
          </p>
          <span className="stat-figure mt-3 block text-3xl font-semibold text-emerald-300">
            {totalQuantity}
          </span>
          <p className="binder-stat-sub mt-2">
            {cards.length} unique {cards.length === 1 ? "card" : "cards"} held
          </p>
          <div className="binder-meter mt-4">
            <span style={{ width: `${Math.min(Math.max(cards.length * 12, 8), 100)}%` }} />
          </div>
          <p className="binder-stat-sub mt-2">Binder capacity pulse</p>
        </div>

        <div className="binder-stat-card" data-trend="flat">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)]">
            Vault Signals
          </p>
          <span className="stat-figure mt-3 block text-3xl font-semibold text-white">
            {notedCards}
            <span className="text-base text-slate-400"> / {cards.length} noted</span>
          </span>
          <p className="binder-stat-sub mt-2">
            {latestCard ? `Latest add ${formatDate(latestCard.addedAt)}` : "Vault ready"}
          </p>
          <div className="binder-meter mt-4">
            <span
              style={{
                width: `${cards.length ? Math.min(Math.max((notedCards / cards.length) * 100, 4), 100) : 4}%`,
              }}
            />
          </div>
          <p className="binder-stat-sub mt-2">Account scoped &middot; Clerk verified</p>
        </div>
      </section>

      <section className="binder-vault-panel relative overflow-visible rounded-3xl p-5 sm:p-7">
        <div className="binder-vault-shine" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--text-faint)]">
              Binder vault
            </p>
            <h2 className="mt-2 text-2xl font-black text-white">Cloud collection</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Your signed-in Clerk account is connected. These cards are loaded directly from
              Supabase and scoped to your user.
            </p>
          </div>
          <Link href="/search" className="btn btn-primary btn-sm w-full sm:w-auto">
            Add more cards
          </Link>
        </div>

        {cards.length === 0 ? (
          <div className="binder-empty-state mt-5 rounded-3xl p-6 text-center sm:mt-6 sm:p-8">
            <div className="pokeball-mark mx-auto" />
            <p className="mt-4 text-lg font-black text-white">Your cloud binder is empty.</p>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
              Your account vault is ready. Add cards from search to start filling this collection
              with cloud-synced holdings.
            </p>
          </div>
        ) : (
          /* PHYSICAL BINDER GRID — each holding rendered as a real 63/88 TCG
             card with the shared HoloTilt 3D tilt + holographic glare. */
          <div className="relative z-10 mt-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 lg:gap-6">
            {cards.map((card, index) => {
              const priceUsd = unitPriceUsd(card);
              const isTopAsset =
                topAsset !== null && card.id === topAsset.id && priceUsd > 0;

              return (
                <article key={card.id} className="binder-holo-slot group">
                  <HoloTilt className="binder-holo-card relative aspect-[63/88] overflow-hidden rounded-[4.5%/3.5%]">
                    <Image
                      src={card.imageUrl}
                      alt={card.name}
                      fill
                      sizes="(max-width: 768px) 45vw, (max-width: 1024px) 24vw, 220px"
                      priority={index < 5}
                      unoptimized
                      className="object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                    <span className="binder-holo-chip binder-holo-chip--qty">
                      &times;{card.quantity}
                    </span>
                    {isTopAsset ? (
                      <span className="binder-holo-chip binder-holo-chip--gold">
                        ★ Top asset
                      </span>
                    ) : null}
                    <div className="binder-holo-plate">
                      <p className="truncate text-sm font-bold text-white">{card.name}</p>
                      <p className="binder-holo-price">
                        {priceUsd > 0 ? formatUsd(priceUsd) : "Price pending"}
                      </p>
                    </div>
                  </HoloTilt>
                  <div className="binder-holo-caption">
                    <span>{formatDate(card.addedAt)}</span>
                    {card.notes?.trim() ? (
                      <span className="binder-mini-chip">{card.notes.trim()}</span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function BinderSignInPrompt() {
  return (
    <section className="glass-card rounded-3xl p-5 sm:p-6">
      <span className="premium-kicker">Cloud binder</span>
      <h2 className="mt-3 font-[var(--font-game-copy)] text-xl font-semibold text-white">
        Sign in to view your binder
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        Binder cards are scoped to your Clerk account and loaded from Supabase.
      </p>
      <Link href="/portfolio/vault" className="btn btn-primary btn-sm mt-4 inline-flex">
        Sign in
      </Link>
    </section>
  );
}

function BinderBackendNotice() {
  return (
    <section className="binder-empty-state rounded-3xl p-6 text-center sm:p-8">
      <div className="pokeball-mark mx-auto" />
      <p className="mt-4 text-lg font-black text-white">Cloud binder is not configured.</p>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
        You are signed in, but the database or Clerk server keys are missing in this environment.
      </p>
    </section>
  );
}

function isClerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

export default async function PortfolioPage() {
  const clerkConfigured = isClerkConfigured();
  const backendConfigured = isAccountBackendConfigured();

  // Without Clerk keys, auth() throws because clerkMiddleware is a no-op.
  // Fall back to the localStorage binder so /portfolio works offline.
  if (!clerkConfigured) {
    const heroPool = await getMarketPickPool();

    return (
      <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
        <section className="binder-hero route-hero relative p-4 sm:p-10 lg:p-12">
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
                Keep raw cards, graded slabs, cost basis, market movement, and portfolio
                performance together in one clean binder view.
              </p>
              <div className="binder-hero-actions flex flex-wrap gap-3 pt-1 sm:gap-4 sm:pt-0">
                <Link href="/search" className="btn btn-primary flex-1 sm:flex-none">
                  Add Cards
                </Link>
                <Link href="/portfolio/vault" className="btn btn-ghost flex-1 sm:flex-none">
                  Cloud Vault
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
                <strong>Local Binder</strong>
              </div>
            </div>
          </div>
        </section>

        <PortfolioClient />
      </main>
    );
  }

  const { userId } = await auth();
  const isSignedIn = Boolean(userId);
  const binderCards =
    isSignedIn && backendConfigured
      ? await getCurrentBinderCards().catch((error) => {
          console.error("Failed to load account binder cards", error);
          return [];
        })
      : null;

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="binder-hero route-hero relative p-4 sm:p-10 lg:p-12">
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
              Keep raw cards, graded slabs, cost basis, market movement, and portfolio performance
              together in one clean binder view.
            </p>
            <div className="binder-hero-actions flex flex-wrap gap-3 pt-1 sm:gap-4 sm:pt-0">
              <Link href="/search" className="btn btn-primary flex-1 sm:flex-none">
                Add Cards
              </Link>
              <Link href="/portfolio/vault" className="btn btn-ghost flex-1 sm:flex-none">
                Cloud Vault
              </Link>
            </div>
          </div>
          <div className="binder-scorecard relative order-first mx-auto w-full max-w-md lg:order-last lg:mx-0 lg:ml-auto">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--text-faint)]">
              Account scoped
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <span>Status</span>
                <strong>{isSignedIn ? "Live" : "Guest"}</strong>
              </div>
              <div>
                <span>Cards</span>
                <strong>{binderCards?.length ?? 0}</strong>
              </div>
            </div>
            <div className="binder-meter mt-5">
              <span
                style={{
                  width: `${Math.min(Math.max((binderCards?.length ?? 0) * 12, 8), 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {!isSignedIn ? (
        <BinderSignInPrompt />
      ) : backendConfigured ? (
        <BinderDashboard cards={binderCards ?? []} />
      ) : (
        <BinderBackendNotice />
      )}
    </main>
  );
}
