import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ClientPrice } from "@/components/client-price";
import { PriceChart } from "@/components/card/price-chart";
import { AddToPortfolioButton } from "@/components/portfolio/add-to-portfolio-button";
import { PsaPopulationSummary } from "@/components/psa/psa-population-summary";
import { getCardBySlug, getCards } from "@/lib/cards";
import { fetchLiveCardById } from "@/lib/pokemon-tcg-api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = getCardBySlug(slug) ?? (await fetchLiveCardById(slug));

  if (!card) {
    return { title: "Card Not Found" };
  }

  return {
    title: `${card.name} ${card.collectorNumber}`,
  };
}

export async function generateStaticParams() {
  return getCards().map((card) => ({ slug: card.slug }));
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const card = getCardBySlug(slug) ?? (await fetchLiveCardById(slug));

  if (!card) {
    notFound();
  }

  const primarySource = card.sources[0];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-6 py-10 sm:px-10 lg:px-12">
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Link href="/search" className="hover:text-white">
          Search
        </Link>
        <span>/</span>
        <span>{card.name}</span>
      </div>

      <section className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="glass-card rounded-3xl p-6">
          <div className="relative mx-auto aspect-[0.72/1] w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-slate-950">
            <Image
              src={card.image}
              alt={card.name}
              fill
              priority
              sizes="(max-width: 768px) 90vw, 420px"
              className="object-contain p-4"
            />
          </div>
        </div>

        <div className="space-y-6">
          <section className="glass-card rounded-3xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-blue-200">
                  {card.setName}
                </p>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
                  {card.name}
                </h1>
                <p className="mt-3 text-sm text-slate-400">
                  #{card.collectorNumber} · {card.rarity} · {card.hp} HP ·{" "}
                  {card.types.join(", ")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-400">
                  Market price
                </p>
                <ClientPrice
                  amountUsd={card.marketPriceUsd}
                  className="mt-2 block text-4xl font-semibold text-blue-300"
                />
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <PsaPopulationSummary
                cardId={card.id}
                initialPopulation={card.psaPopulation}
              />
              <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
                <p className="text-sm text-slate-400">Confidence</p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {Math.round(primarySource.confidence * 100)}%
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
                <p className="text-sm text-slate-400">Fetched</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {new Date(primarySource.fetchedAt).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/4 p-4 text-sm text-slate-300">
              <p className="font-medium text-white">Source note</p>
              <p className="mt-2">
                {primarySource.source} · {primarySource.status} ·{" "}
                {primarySource.note}
              </p>
              <Link
                href={`/psa-import?card=${encodeURIComponent(card.id)}`}
                className="mt-4 inline-flex rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-white/20 hover:text-white"
              >
                Import official PSA pop
              </Link>
            </div>
          </section>

          <AddToPortfolioButton card={card} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <PriceChart points={card.priceHistory} />

        <article className="glass-card rounded-3xl p-6">
          <h2 className="text-xl font-semibold text-white">Graded breakdown</h2>
          <div className="mt-5 space-y-3">
            {card.gradedPrices.map((price) => (
              <div
                key={price.grade}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/4 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-white">{price.grade}</p>
                  {price.grade !== "Ungraded" ? (
                    <p className="mt-1 text-xs text-slate-400">
                      {price.grade.split(" ")[0]} Pop {price.populationCount.toLocaleString()}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400">Raw market snapshot</p>
                  )}
                </div>
                <ClientPrice
                  amountUsd={price.value}
                  className="text-lg font-semibold text-blue-300"
                />
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="glass-card rounded-3xl p-6">
          <h2 className="text-xl font-semibold text-white">Last sold</h2>
          {card.recentSales.length ? (
            <div className="mt-5 space-y-3">
              {card.recentSales.map((sale) => (
                <div
                  key={`${sale.date}-${sale.title}`}
                  className="rounded-2xl border border-white/10 bg-white/4 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-white">{sale.title}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {sale.condition} · {sale.source}
                      </p>
                    </div>
                    <ClientPrice
                      amountUsd={sale.price}
                      className="text-lg font-semibold text-emerald-300"
                    />
                  </div>
                  <p className="mt-3 text-xs text-slate-500">{sale.date}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
              Live sold-comps are not wired yet. The next data-engine phase will
              add sold history from public market sources and store it as chartable snapshots.
            </div>
          )}
        </article>

        <article className="glass-card rounded-3xl p-6">
          <h2 className="text-xl font-semibold text-white">Card identity</h2>
          <div className="mt-5 grid gap-3 text-sm text-slate-300">
            <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
              <p className="text-slate-500">Set code</p>
              <p className="mt-2 font-medium text-white">{card.setCode}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
              <p className="text-slate-500">Artist</p>
              <p className="mt-2 font-medium text-white">{card.artist}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
              <p className="text-slate-500">Supertype</p>
              <p className="mt-2 font-medium text-white">{card.supertype}</p>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
