import type { Metadata } from "next";
import Link from "next/link";

import { VaultAddCardForm } from "@/components/portfolio/vault-add-card-form";
import {
  ensureDbUser,
  getPortfolioOverview,
  isPortfolioBackendConfigured,
} from "@/lib/portfolio-db.server";

export const metadata: Metadata = {
  title: "Cloud Vault",
};

export const dynamic = "force-dynamic";

function usd(value: number) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function SetupNotice() {
  return (
    <div className="glass-card rounded-2xl p-6">
      <h2 className="text-lg font-semibold text-white">Cloud vault is not configured</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
        Set <code>DATABASE_URL</code>, <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and{" "}
        <code>CLERK_SECRET_KEY</code> in the environment to enable server-side portfolios.
        The local binder on <Link href="/portfolio" className="underline">/portfolio</Link>{" "}
        keeps working without them.
      </p>
    </div>
  );
}

function LoadErrorNotice() {
  return (
    <div className="glass-card rounded-2xl p-6">
      <h2 className="text-lg font-semibold text-white">Cloud vault couldn't load</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
        You&apos;re signed in, but the vault database could not be reached. The local binder on{" "}
        <Link href="/portfolio" className="underline">
          /portfolio
        </Link>{" "}
        still works. Reload this page to try again.
      </p>
    </div>
  );
}

function SignInNotice() {
  return (
    <div className="glass-card rounded-2xl p-6">
      <h2 className="text-lg font-semibold text-white">Sign in to open your vault</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
        Use Sign In in the header to authenticate, then return here. The local binder on{" "}
        <Link href="/portfolio" className="underline">
          /portfolio
        </Link>{" "}
        keeps working without an account.
      </p>
    </div>
  );
}

export default async function PortfolioVaultPage() {
  const configured = isPortfolioBackendConfigured();
  let user = null;
  let overview = null;
  let loadError = false;

  if (configured) {
    try {
      user = await ensureDbUser();
      overview = user ? await getPortfolioOverview(user) : null;
    } catch (error) {
      console.error("Failed to load cloud vault", error);
      loadError = true;
    }
  }

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-4 sm:p-10">
      <header className="space-y-2">
        <span className="premium-kicker">Cloud vault</span>
        <h1 className="section-title pokemon-display-title text-3xl text-white sm:text-5xl">
          Your portfolio, everywhere
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-slate-300">
          Server-side holdings synced to your account. Totals are computed live from your
          transaction ledger and the latest market snapshots.
        </p>
      </header>

      {loadError ? (
        <LoadErrorNotice />
      ) : !configured ? (
        <SetupNotice />
      ) : !user || !overview ? (
        <SignInNotice />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Cards held", overview.totals.totalQuantity.toLocaleString("en-US")],
              ["Cost basis", usd(overview.totals.costBasisUsd)],
              ["Market value", usd(overview.totals.marketValueUsd)],
              ["Unrealized P/L", usd(overview.totals.unrealizedGainUsd)],
            ].map(([label, value]) => (
              <div key={label} className="glass-card rounded-2xl p-4 sm:p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  {label}
                </p>
                <p className="mt-1 text-xl font-semibold text-white sm:text-2xl">{value}</p>
              </div>
            ))}
          </section>

          <VaultAddCardForm />

          <section className="glass-card overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.1em] text-slate-400">
                    <th className="px-4 py-3 font-bold">Card</th>
                    <th className="px-4 py-3 font-bold">Grade</th>
                    <th className="px-4 py-3 font-bold">Qty</th>
                    <th className="px-4 py-3 font-bold">Cost basis</th>
                    <th className="px-4 py-3 font-bold">Latest price</th>
                    <th className="px-4 py-3 font-bold">Market value</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-slate-300">
                        No cards yet. Add your first card above, or browse{" "}
                        <Link href="/search" className="underline">
                          search
                        </Link>
                        .
                      </td>
                    </tr>
                  ) : (
                    overview.items.map((item) => (
                      <tr key={item.id} className="border-b border-white/5 text-slate-200">
                        <td className="px-4 py-3">
                          <Link href={`/cards/${item.cardSlug}`} className="hover:underline">
                            {item.cardName ?? item.cardSlug}
                          </Link>
                          {item.setName ? (
                            <span className="block text-xs text-slate-400">{item.setName}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">{item.grade}</td>
                        <td className="px-4 py-3">{item.quantity}</td>
                        <td className="px-4 py-3">{usd(item.costBasisUsd)}</td>
                        <td className="px-4 py-3">
                          {item.latestPriceUsd === null ? "—" : usd(item.latestPriceUsd)}
                        </td>
                        <td className="px-4 py-3">
                          {item.marketValueUsd === null ? "—" : usd(item.marketValueUsd)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
