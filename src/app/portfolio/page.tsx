import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  getCurrentBinderCards,
  isAccountBackendConfigured,
  type BinderCard,
} from "@/lib/account-db.server";

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

function BinderDashboard({ cards }: { cards: BinderCard[] }) {
  const totalQuantity = cards.reduce((sum, card) => sum + card.quantity, 0);
  const notedCards = cards.filter((card) => card.notes?.trim()).length;
  const latestCard = cards[0];
  const totalMarketValue = cards.reduce((sum, card) => {
    const market = card.marketPrice ? Number.parseFloat(card.marketPrice) : 0;
    return sum + (Number.isFinite(market) ? market * card.quantity : 0);
  }, 0);

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="binder-dashboard grid gap-5 lg:grid-cols-[0.95fr_1.25fr]">
        <div className="binder-scorecard">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--text-faint)]">
            Collection grade
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <span>Cards</span>
              <strong>{cards.length}</strong>
            </div>
            <div>
              <span>Quantity</span>
              <strong>{totalQuantity}</strong>
            </div>
          </div>
          <div className="binder-meter mt-5">
            <span style={{ width: `${Math.min(Math.max(cards.length * 12, 8), 100)}%` }} />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <div className="binder-stat-card" data-trend="flat">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)] sm:text-sm sm:tracking-[0.24em]">
              Vault Cards
            </p>
            <span className="stat-figure mt-2 block text-2xl font-semibold text-white sm:mt-3 sm:text-3xl">
              {cards.length}
            </span>
          </div>
          <div className="binder-stat-card" data-trend="up">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)] sm:text-sm sm:tracking-[0.24em]">
              Total Qty
            </p>
            <span className="stat-figure mt-2 block text-2xl font-semibold text-emerald-300 sm:mt-3 sm:text-3xl">
              {totalQuantity}
            </span>
            <p className="mt-2 text-xs text-slate-400">Synced from Supabase</p>
          </div>
          <div className="binder-stat-card" data-trend={totalMarketValue > 0 ? "up" : "flat"}>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-faint)] sm:text-sm sm:tracking-[0.24em]">
              Market Value
            </p>
            <span className="stat-figure mt-2 block text-2xl font-semibold text-white sm:mt-3 sm:text-3xl">
              ${totalMarketValue.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <p className="mt-2 text-xs text-slate-400">
              {notedCards} noted / {latestCard ? `latest ${formatDate(latestCard.addedAt)}` : "ready"}
            </p>
          </div>
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
          <div className="binder-vault-grid binder-vault-card-grid relative z-10 mt-6 grid gap-4">
            {cards.map((card, index) => (
              <article key={card.id} className="binder-item-card binder-cloud-card">
                <div className="binder-cloud-card-art">
                  <Image
                    src={card.imageUrl}
                    alt={card.name}
                    fill
                    sizes="82px"
                    priority={index < 6}
                    unoptimized
                    className="object-contain"
                  />
                </div>
                <div className="binder-item-identity min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-white">{card.name}</span>
                    <span className="premium-badge">Qty {card.quantity}</span>
                    {index < 5 ? <span className="binder-mini-chip">Top shelf</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    Added {formatDate(card.addedAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300">
                    <span className="binder-mini-chip">Supabase</span>
                    <span className="binder-mini-chip">Account scoped</span>
                  </div>
                </div>
                <div className="binder-value-grid">
                  <div className="binder-value-cell">
                    <p>Card ID</p>
                    <span className="mt-1 block font-black text-white">{card.cardId}</span>
                    <span>Pokemon TCG API identity</span>
                  </div>
                  <div className="binder-value-cell">
                    <p>Market</p>
                    <span className="mt-1 block font-black text-emerald-300">
                      {card.marketPrice
                        ? `$${Number.parseFloat(card.marketPrice).toFixed(2)}`
                        : "Pending"}
                    </span>
                    <span>Captured at add time</span>
                  </div>
                  <div className="binder-value-cell">
                    <p>Notes</p>
                    <span className="mt-1 block font-black text-white">
                      {card.notes?.trim() || "None"}
                    </span>
                    <span>User-specific metadata</span>
                  </div>
                  <div className="binder-value-cell">
                    <p>Updated</p>
                    <span className="mt-1 block font-black text-white">
                      {formatDate(card.updatedAt)}
                    </span>
                    <span>Last database change</span>
                  </div>
                </div>
              </article>
            ))}
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

export default async function PortfolioPage() {
  const { userId } = await auth();
  const isSignedIn = Boolean(userId);
  const backendConfigured = isAccountBackendConfigured();
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
