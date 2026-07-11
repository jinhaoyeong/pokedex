"use client";

import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";

import { updateAccountCurrency } from "@/app/settings/actions";
import type { SupportedCurrency } from "@/types/pokemon";

const CURRENCY_OPTIONS: SupportedCurrency[] = ["MYR", "USD", "EUR", "GBP", "JPY"];

type AccountSettingsPanelProps = {
  clerkConfigured: boolean;
  backendConfigured: boolean;
  /** Server-resolved Clerk user id when available. */
  signedInUserId: string | null;
  preferredCurrency: string | null;
  syncFailed: boolean;
};

function SyncedSettingsForm({ preferredCurrency }: { preferredCurrency: string }) {
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

function SignedOutPrompt() {
  return (
    <section className="glass-card rounded-3xl p-5 sm:p-6">
      <span className="premium-kicker">Account settings</span>
      <h2 className="mt-3 font-[var(--font-game-copy)] text-xl font-semibold text-white">
        Sign in to sync settings
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        Local app settings still work below. Sign in to store account preferences in Supabase.
      </p>
      <SignInButton mode="modal">
        <button type="button" className="btn btn-primary btn-sm mt-4 inline-flex">
          Sign In
        </button>
      </SignInButton>
    </section>
  );
}

function SignedInUnavailable({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="glass-card rounded-3xl p-5 sm:p-6">
      <span className="premium-kicker">Account settings</span>
      <h2 className="mt-3 font-[var(--font-game-copy)] text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{body}</p>
      <p className="mt-4 text-sm text-slate-300">
        You are signed in. Use the profile menu in the header to manage your account or sign out.
        Local settings below still apply on this device.
      </p>
      <Link href="/portfolio/vault" className="btn btn-secondary btn-sm mt-4 inline-flex">
        Open cloud vault
      </Link>
    </section>
  );
}

function AuthUnavailable() {
  return (
    <section className="glass-card rounded-3xl p-5 sm:p-6">
      <span className="premium-kicker">Account settings</span>
      <h2 className="mt-3 font-[var(--font-game-copy)] text-xl font-semibold text-white">
        Account sync unavailable
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        Clerk is not configured in this environment. Local app settings below still work in this
        browser.
      </p>
    </section>
  );
}

export function AccountSettingsPanel({
  clerkConfigured,
  backendConfigured,
  signedInUserId,
  preferredCurrency,
  syncFailed,
}: AccountSettingsPanelProps) {
  const { isLoaded, isSignedIn } = useUser();

  // Prefer live client session so Settings matches the header UserButton.
  const signedIn = isLoaded ? isSignedIn : Boolean(signedInUserId);

  if (!clerkConfigured) {
    return <AuthUnavailable />;
  }

  if (preferredCurrency) {
    return <SyncedSettingsForm preferredCurrency={preferredCurrency} />;
  }

  if (signedIn) {
    if (syncFailed) {
      return (
        <SignedInUnavailable
          title="Couldn't sync account settings"
          body="You're signed in, but account preferences could not be loaded from Supabase. Local settings below still work."
        />
      );
    }

    if (!backendConfigured) {
      return (
        <SignedInUnavailable
          title="Cloud sync is not configured"
          body="You're signed in with Clerk, but DATABASE_URL is missing so preferences cannot sync to Supabase yet."
        />
      );
    }

    return (
      <SignedInUnavailable
        title="Account preferences pending"
        body="You're signed in. Synced preferences were not available yet — try reloading, or continue with local settings below."
      />
    );
  }

  if (!backendConfigured) {
    return (
      <section className="glass-card rounded-3xl p-5 sm:p-6">
        <span className="premium-kicker">Account settings</span>
        <h2 className="mt-3 font-[var(--font-game-copy)] text-xl font-semibold text-white">
          Sign in to sync settings
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Local app settings still work below. Cloud preference sync needs a database connection in
          addition to Clerk.
        </p>
        <SignInButton mode="modal">
          <button type="button" className="btn btn-primary btn-sm mt-4 inline-flex">
            Sign In
          </button>
        </SignInButton>
      </section>
    );
  }

  return <SignedOutPrompt />;
}
