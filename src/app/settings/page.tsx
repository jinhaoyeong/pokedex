import type { Metadata } from "next";
import Link from "next/link";

import { updateAccountCurrency } from "@/app/settings/actions";
import { SettingsClient } from "@/components/settings/settings-client";
import {
  getCurrentAccountSettings,
  isAccountBackendConfigured,
} from "@/lib/account-db.server";
import type { SupportedCurrency } from "@/types/pokemon";

export const metadata: Metadata = {
  title: "Settings",
};

export const dynamic = "force-dynamic";

const CURRENCY_OPTIONS: SupportedCurrency[] = ["MYR", "USD", "EUR", "GBP", "JPY"];

function AccountSettingsCard({
  preferredCurrency,
}: {
  preferredCurrency: string;
}) {
  return (
    <section className="glass-card rounded-3xl p-5 sm:p-6">
      <div className="mb-4 space-y-2">
        <span className="premium-kicker">Account settings</span>
        <h2 className="font-[var(--font-game-copy)] text-xl font-semibold text-white">
          Synced preferences
        </h2>
        <p className="text-sm leading-6 text-slate-400">
          These preferences are stored in Supabase and follow your Clerk account.
        </p>
      </div>
      <form action={updateAccountCurrency} className="grid gap-3 sm:max-w-xs">
        <label className="grid gap-2 text-sm font-semibold text-slate-200">
          Preferred currency
          <select
            name="preferredCurrency"
            defaultValue={preferredCurrency}
            className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
          >
            {CURRENCY_OPTIONS.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          Save account settings
        </button>
      </form>
    </section>
  );
}

function AccountSettingsPrompt() {
  return (
    <section className="glass-card rounded-3xl p-5 sm:p-6">
      <span className="premium-kicker">Account settings</span>
      <h2 className="mt-3 font-[var(--font-game-copy)] text-xl font-semibold text-white">
        Sign in to sync settings
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        Local app settings still work below. Sign in to store account preferences in Supabase.
      </p>
      <Link href="/portfolio/vault" className="btn btn-primary btn-sm mt-4 inline-flex">
        Sign in
      </Link>
    </section>
  );
}

export default async function SettingsPage() {
  const accountSettings = isAccountBackendConfigured()
    ? await getCurrentAccountSettings()
    : null;

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="settings-hero route-hero relative overflow-hidden p-5 sm:p-6">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />
        <div className="relative z-10 max-w-3xl space-y-3">
          <span className="premium-kicker">Trainer preferences</span>
          <h1 className="section-title pokemon-display-title text-[1.8rem] text-white sm:text-5xl">
            Settings
          </h1>
          <p className="hero-subline max-w-2xl">
            Defaults for search, charts, and binder actions. Manage local data stored in this
            browser — no account required.
          </p>
        </div>
      </section>

      {accountSettings ? (
        <AccountSettingsCard preferredCurrency={accountSettings.preferredCurrency} />
      ) : (
        <AccountSettingsPrompt />
      )}

      <SettingsClient />
    </main>
  );
}
