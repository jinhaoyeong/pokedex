"use client";

import dynamic from "next/dynamic";

const AccountSettingsAuthIsland = dynamic(
  () =>
    import("@/components/settings/account-settings-auth-island").then(
      (module) => module.AccountSettingsAuthIsland,
    ),
  {
    ssr: false,
    loading: () => (
      <section className="glass-card rounded-3xl p-5 sm:p-6">
        <span className="premium-kicker">Account settings</span>
        <h2 className="mt-3 font-[var(--font-game-copy)] text-xl font-semibold text-white">
          Loading account
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Checking whether cloud preferences can sync for this session.
        </p>
      </section>
    ),
  },
);

type AccountSettingsPanelProps = {
  clerkConfigured: boolean;
  backendConfigured: boolean;
  signedInUserId: string | null;
  preferredCurrency: string | null;
  formCurrency: string;
  syncFailed: boolean;
};

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
  formCurrency,
  syncFailed,
}: AccountSettingsPanelProps) {
  if (!clerkConfigured) return <AuthUnavailable />;
  return (
    <AccountSettingsAuthIsland
      backendConfigured={backendConfigured}
      signedInUserId={signedInUserId}
      preferredCurrency={preferredCurrency}
      formCurrency={formCurrency}
      syncFailed={syncFailed}
    />
  );
}
