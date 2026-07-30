import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";

import { AccountSettingsPanel } from "@/components/settings/account-settings-panel";
import { DesignComparisonDock } from "@/components/design-comparison-dock";
import { SettingsClient } from "@/components/settings/settings-client";
import {
  getCurrentAccountSettings,
  isAccountBackendConfigured,
} from "@/lib/account-db.server";

export const metadata: Metadata = {
  title: "Settings",
};

export const dynamic = "force-dynamic";

const settingsChanges = [
  "Preferences are grouped into a scannable settings directory.",
  "Every section has a stable anchor for quick navigation.",
  "Backup and restore are positioned before destructive actions.",
  "Clearing a binder now names the affected card count and confirms.",
  "Storage keys wrap safely and recovery feedback stays actionable.",
] as const;

export default async function SettingsPage() {
  // Match root layout: ClerkProvider mounts when the publishable key exists.
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const backendConfigured = isAccountBackendConfigured();

  const signedInUserId = clerkConfigured
    ? ((await auth().catch(() => ({ userId: null }))).userId ?? null)
    : null;

  let preferredCurrency: string | null = null;
  let syncFailed = false;

  if (backendConfigured && signedInUserId) {
    try {
      const accountSettings = await getCurrentAccountSettings();
      preferredCurrency = accountSettings?.preferredCurrency ?? null;
      if (!preferredCurrency) {
        syncFailed = true;
      }
    } catch (error) {
      console.error("Failed to load account settings", error);
      syncFailed = true;
    }
  }

  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="settings-hero route-hero relative overflow-hidden p-5 sm:p-6">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />
        <div className="relative z-10 max-w-3xl space-y-3">
          <span className="premium-kicker surface-original-only">Trainer preferences</span>
          <h1 className="section-title pokemon-display-title surface-original-only text-[1.8rem] text-white sm:text-5xl">
            Settings
          </h1>
          <h1 className="section-title pokemon-display-title surface-improved-only text-[2rem] text-white sm:text-5xl">
            Make the Dex yours.
          </h1>
          <p className="hero-subline surface-original-only max-w-2xl">
            Defaults for search, charts, and binder actions. Manage local data stored in this
            browser — no account required.
          </p>
          <p className="hero-subline surface-improved-only max-w-2xl">
            Set your search and binder defaults, protect your collection data, and control what
            stays on this device.
          </p>
        </div>
      </section>

      <AccountSettingsPanel
        clerkConfigured={clerkConfigured}
        backendConfigured={backendConfigured}
        signedInUserId={signedInUserId}
        preferredCurrency={preferredCurrency}
        syncFailed={syncFailed}
      />

      <SettingsClient />
      <DesignComparisonDock surface="Settings" changes={settingsChanges} />
    </main>
  );
}
