import type { Metadata } from "next";

import { PortfolioClient } from "@/components/portfolio/portfolio-client";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default function PortfolioPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-6 py-10 sm:px-10 lg:px-12">
      <section className="space-y-4">
        <span className="inline-flex rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-200">
          Portfolio tracking
        </span>
        <h1 className="section-title max-w-4xl">
          Track your holdings with live local pricing and currency conversion.
        </h1>
        <p className="section-copy max-w-3xl">
          Portfolio entries currently persist in local storage until the
          database layer is ready again.
        </p>
      </section>

      <PortfolioClient />
    </main>
  );
}
