import type { Metadata } from "next";
import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { AccountCurrencySync } from "@/components/settings/account-currency-sync";
import { AccountSettingsPanel } from "@/components/settings/account-settings-panel";
import { SettingsClient } from "@/components/settings/settings-client";
import {
  getCurrentAccountSettings,
  isAccountBackendConfigured,
} from "@/lib/account-db.server";
import {
  CURRENCY_COOKIE_NAME,
  DEFAULT_PREFERRED_CURRENCY,
  parseSupportedCurrency,
} from "@/lib/currency-preference";

export const metadata: Metadata = {
  title: "Settings",
};

function SettingsHero() {
  return (
    <section className="settings-hero route-hero relative overflow-hidden p-5 sm:p-8">
      <span className="pixel-cloud left-[8%] top-[10%]" />
      <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />
      <div className="relative z-10 mx-auto max-w-3xl space-y-3 text-left sm:text-center">
        <span className="premium-kicker sm:mx-auto">Trainer preferences</span>
        <h1 className="section-title pokemon-display-title text-[1.8rem] text-white sm:text-5xl">
          Settings
        </h1>
        <p className="hero-subline sm:mx-auto">
          Defaults for search, charts, and binder actions. Manage local data stored in this
          browser — no account required.
        </p>
      </div>
    </section>
  );
}

function AccountSettingsFallback({ clerkConfigured }: { clerkConfigured: boolean }) {
  if (!clerkConfigured) {
    return (
      <AccountSettingsPanel
        clerkConfigured={false}
        backendConfigured={false}
        signedInUserId={null}
        preferredCurrency={null}
        formCurrency={DEFAULT_PREFERRED_CURRENCY}
        syncFailed={false}
      />
    );
  }

  return (
    <section className="glass-card rounded-3xl p-5 sm:p-8" aria-hidden="true">
      <div className="h-3 w-28 animate-pulse rounded-full bg-white/10" />
      <div className="mt-3 h-6 w-48 animate-pulse rounded-md bg-white/12" />
      <div className="mt-2 h-12 w-full max-w-xl animate-pulse rounded-md bg-white/8" />
    </section>
  );
}

async function SettingsAccountSection({ clerkConfigured }: { clerkConfigured: boolean }) {
  if (!clerkConfigured) {
    return <AccountSettingsFallback clerkConfigured={false} />;
  }

  const backendConfigured = isAccountBackendConfigured();
  const signedInUserId =
    (await auth().catch(() => ({ userId: null }))).userId ?? null;

  let preferredCurrency: string | null = null;
  let syncFailed = false;
  const cookieStore = await cookies();
  const formCurrency =
    parseSupportedCurrency(cookieStore.get(CURRENCY_COOKIE_NAME)?.value) ??
    DEFAULT_PREFERRED_CURRENCY;

  if (backendConfigured && signedInUserId) {
    try {
      const accountSettings = await getCurrentAccountSettings(signedInUserId);
      if (!accountSettings) {
        syncFailed = true;
      } else {
        preferredCurrency =
          accountSettings.preferredCurrency?.trim() || DEFAULT_PREFERRED_CURRENCY;
      }
    } catch (error) {
      console.error("Failed to load account settings", error);
      syncFailed = true;
    }
  }

  return (
    <>
      <AccountCurrencySync preferredCurrency={preferredCurrency} />
      <AccountSettingsPanel
        clerkConfigured={clerkConfigured}
        backendConfigured={backendConfigured}
        signedInUserId={signedInUserId}
        preferredCurrency={preferredCurrency}
        formCurrency={preferredCurrency ?? formCurrency}
        syncFailed={syncFailed}
      />
    </>
  );
}

export default function SettingsPage() {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <main className="app-main settings-page-main app-frame flex min-h-screen w-full flex-col">
      <SettingsHero />

      <div className="settings-layout">
        <Suspense fallback={<AccountSettingsFallback clerkConfigured={clerkConfigured} />}>
          <SettingsAccountSection clerkConfigured={clerkConfigured} />
        </Suspense>
        <SettingsClient />
      </div>
    </main>
  );
}
