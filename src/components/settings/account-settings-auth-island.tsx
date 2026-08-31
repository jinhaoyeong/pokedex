"use client";

import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { updateAccountCurrency } from "@/app/settings/actions";
import type { SupportedCurrency } from "@/types/pokemon";

const CURRENCY_OPTIONS: SupportedCurrency[] = ["MYR", "USD", "EUR", "GBP", "JPY"];

type Props = {
  backendConfigured: boolean;
  signedInUserId: string | null;
  preferredCurrency: string | null;
  formCurrency: string;
  syncFailed: boolean;
};

function CurrencyForm({ defaultCurrency }: { defaultCurrency: string }) {
  return (
    <form action={updateAccountCurrency} className="grid gap-3 sm:max-w-xs">
      <label className="grid gap-2 text-sm font-semibold text-slate-200">
        Preferred currency
        <select
          name="preferredCurrency"
          defaultValue={defaultCurrency}
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
  );
}

function AccountCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <section className="glass-card rounded-3xl p-5 sm:p-6">
      <span className="premium-kicker">Account settings</span>
      <h2 className="mt-3 font-[var(--font-game-copy)] text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{body}</p>
      {children}
    </section>
  );
}

function ClerkAwareAccountSettings(props: Props) {
  const { isLoaded, isSignedIn } = useUser();
  const signedIn = isLoaded ? Boolean(isSignedIn) : Boolean(props.signedInUserId);

  if (signedIn && props.preferredCurrency && !props.syncFailed) {
    return (
      <AccountCard
        title="Synced preferences"
        body="These preferences are stored in Supabase and follow your Clerk account."
      >
        <div className="mt-4">
          <CurrencyForm defaultCurrency={props.preferredCurrency} />
        </div>
      </AccountCard>
    );
  }

  if (signedIn) {
    if (props.syncFailed) {
      return (
        <AccountCard
          title="Couldn't sync account settings"
          body="You're signed in, but account preferences could not be loaded from Supabase. Currency still saves on this device, and we'll retry cloud sync when you save."
        >
          <p className="mt-3 text-sm text-slate-300">
            Use the profile menu in the header to manage your account or sign out.
          </p>
          <div className="mt-4">
            <CurrencyForm defaultCurrency={props.formCurrency} />
          </div>
          <Link href="/portfolio/vault" className="btn btn-secondary btn-sm mt-4 inline-flex">
            Open cloud vault
          </Link>
        </AccountCard>
      );
    }

    if (!props.backendConfigured) {
      return (
        <AccountCard
          title="Cloud sync is not configured"
          body="You're signed in with Clerk, but DATABASE_URL is missing so preferences cannot sync to Supabase yet. Local settings below still apply on this device."
        >
          <div className="mt-4">
            <CurrencyForm defaultCurrency={props.formCurrency} />
          </div>
        </AccountCard>
      );
    }

    return (
      <AccountCard
        title="Account preferences pending"
        body="You're signed in. Synced preferences were not available yet — try reloading, or continue with local settings below."
      >
        <div className="mt-4">
          <CurrencyForm defaultCurrency={props.formCurrency} />
        </div>
      </AccountCard>
    );
  }

  return (
    <AccountCard
      title="Sign in to sync settings"
      body="Local app settings still work below. Sign in to store account preferences in Supabase."
    >
      <SignInButton mode="modal">
        <button type="button" className="btn btn-primary btn-sm mt-4 inline-flex">
          Sign In
        </button>
      </SignInButton>
    </AccountCard>
  );
}

export function AccountSettingsAuthIsland(props: Props) {
  return <ClerkAwareAccountSettings {...props} />;
}
