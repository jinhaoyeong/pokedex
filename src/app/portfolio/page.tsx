import type { Metadata } from "next";

import { PortfolioClient } from "@/components/portfolio/portfolio-client";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default function PortfolioPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <section className="relative overflow-hidden rounded-[1.5rem] border border-yellow-200/20 bg-gradient-to-br from-[#142d64] via-[#0b1022] to-[#2a1018] p-4 sm:rounded-[2rem] sm:p-8">
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full border-[14px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-40 sm:h-40 sm:w-40 sm:border-[18px] sm:opacity-55" />
        <div className="relative space-y-3 sm:space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-yellow-300/30 bg-yellow-300/12 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-yellow-100 sm:px-4 sm:text-sm sm:tracking-[0.18em]">
            <span className="energy-spark" />
            Binder vault
          </span>
          <h1 className="section-title max-w-4xl">
            Track your Pokemon card holdings like a trainer&apos;s elite binder.
          </h1>
          <p className="section-copy max-w-3xl">
            Save cards from detail pages, compare current value against cost basis,
            and keep your collection ready for the next trade.
          </p>
        </div>
      </section>

      <PortfolioClient />
    </main>
  );
}
