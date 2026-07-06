import type { Metadata } from "next";
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

function BinderCardTable({ cards }: { cards: BinderCard[] }) {
  return (
    <section className="glass-card overflow-hidden rounded-3xl">
      <div className="border-b border-white/10 px-5 py-4 sm:px-6">
        <span className="premium-kicker">Cloud binder</span>
        <h2 className="mt-2 font-[var(--font-game-copy)] text-xl font-semibold text-white">
          Account cards
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.1em] text-slate-400">
              <th className="px-5 py-3 font-bold">Card ID</th>
              <th className="px-5 py-3 font-bold">Qty</th>
              <th className="px-5 py-3 font-bold">Notes</th>
              <th className="px-5 py-3 font-bold">Added</th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-slate-300">
                  No account binder cards yet. Add cards from search once the live add flow is
                  connected to Supabase.
                </td>
              </tr>
            ) : (
              cards.map((card) => (
                <tr key={card.id} className="border-b border-white/5 text-slate-200">
                  <td className="px-5 py-3 font-semibold">{card.cardId}</td>
                  <td className="px-5 py-3">{card.quantity}</td>
                  <td className="px-5 py-3">{card.notes || "—"}</td>
                  <td className="px-5 py-3">
                    {new Date(card.addedAt).toLocaleDateString("en-US")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
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
        Binder cards are now scoped to your Clerk account and loaded from Supabase.
      </p>
      <Link href="/portfolio/vault" className="btn btn-primary btn-sm mt-4 inline-flex">
        Sign in
      </Link>
    </section>
  );
}

export default async function PortfolioPage() {
  const binderCards = isAccountBackendConfigured()
    ? await getCurrentBinderCards().catch((error) => {
        console.error("Failed to load account binder cards", error);
        return null;
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
          <div className="glass-card relative order-first mx-auto w-full max-w-md rounded-3xl p-5 lg:order-last lg:mx-0 lg:ml-auto">
            <span className="premium-kicker">Account scoped</span>
            <p className="mt-3 text-4xl font-semibold text-white">
              {binderCards?.length ?? 0}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Cards loaded from the signed-in user&apos;s Supabase binder.
            </p>
          </div>
        </div>
      </section>

      {binderCards ? <BinderCardTable cards={binderCards} /> : <BinderSignInPrompt />}
    </main>
  );
}
