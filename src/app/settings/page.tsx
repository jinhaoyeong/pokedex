import type { Metadata } from "next";
import { Suspense } from "react";

import { SettingsClient } from "@/components/settings/settings-client";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col">
      <section className="route-hero relative overflow-hidden p-5 sm:p-10 lg:p-12">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />
        <div className="relative z-10 max-w-3xl space-y-4">
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

      <div className="px-5 pb-10 sm:px-10 lg:px-12">
        <Suspense fallback={null}>
          <SettingsClient />
        </Suspense>
      </div>
    </main>
  );
}
