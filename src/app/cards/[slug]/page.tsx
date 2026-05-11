import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ClientPrice } from "@/components/client-price";
import { GradedMarketPanel } from "@/components/card/graded-market-panel";
import { AddToPortfolioButton } from "@/components/portfolio/add-to-portfolio-button";
import { getCardBySlug, getCards } from "@/lib/cards";
import { loadCardWithGradingMarket } from "@/lib/grading-market";
import { fetchLiveCardBySlug } from "@/lib/pokemon-tcg-api";

/** Enrich on every request; avoids slow external calls during static prerender. */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = getCardBySlug(slug) ?? (await fetchLiveCardBySlug(slug));

  if (!card) {
    return { title: "Card Not Found" };
  }

  const displayTitle =
    card.language !== "en" && card.localizedName?.trim()
      ? card.localizedName
      : card.name;

  return {
    title: `${displayTitle} ${card.collectorNumber}`,
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
  const baseCard = getCardBySlug(slug) ?? (await fetchLiveCardBySlug(slug));

  if (!baseCard) {
    notFound();
  }

  const { card, gradingEnriched } = await loadCardWithGradingMarket(baseCard);

  const primarySource = card.sources[0];
  const typeLabel = card.types.join(", ") || "Type pending";
  const displayName =
    card.language !== "en" && card.localizedName?.trim()
      ? card.localizedName
      : card.name;
  const displaySetName =
    card.language !== "en" && card.setLocalizedName?.trim()
      ? card.setLocalizedName
      : card.setName;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-400">
        <Link
          href="/search"
          className="rounded-full border border-white/10 px-3 py-1 hover:border-yellow-200/40 hover:text-white"
        >
          Card Dex
        </Link>
        <span>/</span>
        <span className="text-yellow-100">{displayName}</span>
      </div>

      <section className="grid gap-5 sm:gap-8 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="glass-card card-float relative overflow-hidden rounded-[1.5rem] border-yellow-200/20 p-4 sm:rounded-[2rem] sm:p-6">
          <div className="absolute -left-14 top-8 h-28 w-28 rounded-full border-[12px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:-left-12 sm:top-10 sm:h-32 sm:w-32 sm:border-[16px] sm:opacity-45" />
          <div className="absolute right-5 top-5 sm:right-6 sm:top-6">
            <div className="energy-orbit" />
          </div>
          <div className="relative mx-auto aspect-[0.72/1] w-full max-w-[17rem] overflow-hidden rounded-[1.25rem] border border-yellow-200/25 bg-gradient-to-br from-slate-950 via-[#091737] to-slate-950 shadow-2xl shadow-blue-950/40 sm:max-w-sm sm:rounded-[1.7rem]">
            <div className="absolute inset-x-8 top-4 h-10 rounded-full bg-yellow-200/10 blur-xl" />
            <Image
              src={card.image}
              alt={displayName}
              fill
              priority
              sizes="(max-width: 768px) 90vw, 420px"
              className="object-contain p-4 drop-shadow-2xl"
            />
          </div>
          <div className="relative mt-5 flex flex-wrap justify-center gap-2">
            <span className="type-chip rounded-full px-3 py-1 text-xs font-black">
              {card.languageLabel}
            </span>
            <span className="type-chip rounded-full px-3 py-1 text-xs font-black">
              #{card.collectorNumber}
            </span>
            <span className="type-chip rounded-full px-3 py-1 text-xs font-black">
              {typeLabel}
            </span>
          </div>
        </div>

        <div className="space-y-6">
          <section className="glass-card relative overflow-hidden rounded-[1.5rem] border-yellow-200/20 p-4 sm:rounded-[2rem] sm:p-6">
            <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-yellow-300/8 blur-3xl sm:-right-16 sm:-top-16 sm:h-44 sm:w-44" />
            <div className="absolute bottom-0 right-0 h-1 w-2/3 bg-gradient-to-r from-transparent via-yellow-300/50 to-blue-400/50" />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="relative">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-yellow-200">
                  {displaySetName} / {card.languageLabel}
                </p>
                <h1 className="mt-3 text-2xl font-black tracking-normal text-white sm:text-4xl">
                  {displayName}
                </h1>
                {card.language !== "en" && card.englishName?.trim() ? (
                  <p className="mt-2 text-sm text-slate-400">
                    English listing name: {card.englishName}
                  </p>
                ) : null}
                <p className="mt-3 break-words text-sm text-slate-400">
                  #{card.collectorNumber} / {card.rarity} / {card.hp} HP / {typeLabel}
                </p>
              </div>
              <div className="relative w-full rounded-3xl border border-blue-300/25 bg-blue-500/10 px-4 py-3 sm:w-auto sm:px-5 sm:py-4 sm:text-right">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-200">
                  Market price
                </p>
                <ClientPrice
                  amountUsd={card.marketPriceUsd}
                  className="mt-2 block text-2xl font-semibold text-blue-300 sm:text-4xl"
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-3 sm:gap-4">
              <div className="rounded-2xl border border-yellow-200/20 bg-yellow-300/8 p-3 sm:p-4">
                <p className="text-sm font-bold text-yellow-100">Population</p>
                <div className="mt-2 space-y-1">
                  <p className="text-2xl font-semibold text-white">
                    {typeof card.psaPopulation.totalCertified === "number"
                      ? card.psaPopulation.totalCertified.toLocaleString()
                      : "Pending"}
                  </p>
                  <p className="text-sm text-slate-400">
                    {card.psaPopulation.grades.length
                      ? `${card.psaPopulation.grades.length} grades tracked`
                      : "Automatic population sync pending"}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-blue-300/20 bg-blue-500/8 p-3 sm:p-4">
                <p className="text-sm font-bold text-blue-100">Confidence</p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {Math.round(primarySource.confidence * 100)}%
                </p>
              </div>
              <div className="rounded-2xl border border-red-300/20 bg-red-500/8 p-3 sm:p-4">
                <p className="text-sm font-bold text-red-100">Fetched</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {new Date(primarySource.fetchedAt).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-300 sm:mt-6 sm:p-4">
              <p className="font-medium text-white">Source note</p>
              <p className="mt-2 break-words">
                {primarySource.source} / {primarySource.status} / {primarySource.note}
              </p>
            </div>
          </section>

          <AddToPortfolioButton card={card} />
        </div>
      </section>

      <GradedMarketPanel
        key={card.slug}
        card={card}
        liveMarketPrefetched={gradingEnriched}
      />

      <section className="grid gap-6 lg:grid-cols-1">
        <article className="glass-card relative overflow-hidden rounded-3xl p-4 sm:p-6">
          <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full border-[12px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-40" />
          <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
            Pokedex identity
          </p>
          <h2 className="mt-2 text-xl font-black text-white">Card identity</h2>
          <div className="relative mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
            <div className="rounded-2xl border border-yellow-200/15 bg-yellow-300/8 p-3 sm:p-4">
              <p className="text-slate-400">Set code</p>
              <p className="mt-2 font-medium text-white">{card.setCode}</p>
            </div>
            <div className="rounded-2xl border border-blue-300/15 bg-blue-500/8 p-3 sm:p-4">
              <p className="text-slate-400">Artist</p>
              <p className="mt-2 font-medium text-white">{card.artist}</p>
            </div>
            <div className="rounded-2xl border border-red-300/15 bg-red-500/8 p-3 sm:p-4">
              <p className="text-slate-400">Supertype</p>
              <p className="mt-2 font-medium text-white">{card.supertype}</p>
            </div>
            <div className="rounded-2xl border border-yellow-200/15 bg-yellow-300/8 p-3 sm:p-4">
              <p className="text-slate-400">Stage</p>
              <p className="mt-2 font-medium text-white">{card.stage ?? "Not listed"}</p>
            </div>
            <div className="rounded-2xl border border-blue-300/15 bg-blue-500/8 p-3 sm:p-4">
              <p className="text-slate-400">Dex number</p>
              <p className="mt-2 font-medium text-white">
                {card.dexIds?.length ? card.dexIds.map((id) => `#${id}`).join(", ") : "Not listed"}
              </p>
            </div>
            <div className="rounded-2xl border border-red-300/15 bg-red-500/8 p-3 sm:p-4">
              <p className="text-slate-400">Set size</p>
              <p className="mt-2 font-medium text-white">
                {card.setPrintedTotal ?? card.setTotal
                  ? `${card.setPrintedTotal ?? "?"}/${card.setTotal ?? card.setPrintedTotal}`
                  : "Not listed"}
              </p>
            </div>
          </div>
        </article>
      </section>

      {card.language !== "en" || card.attacks?.length ? (
        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <article className="glass-card rounded-3xl p-4 sm:p-6">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
              Language release
            </p>
            <h2 className="mt-2 text-xl font-black text-white">Localized card data</h2>
            <div className="mt-5 space-y-3 text-sm text-slate-300">
              <p>
                Local name:{" "}
                <span className="font-semibold text-white">
                  {card.localizedName ?? card.name}
                </span>
              </p>
              <p>
                English name:{" "}
                <span className="font-semibold text-white">
                  {card.englishName ?? "Best match unavailable"}
                </span>
              </p>
              <p>
                Local set:{" "}
                <span className="font-semibold text-white">
                  {card.setLocalizedName ?? card.setName}
                </span>
              </p>
              <p>
                English set:{" "}
                <span className="font-semibold text-white">
                  {card.setEnglishName ?? "Best match unavailable"}
                </span>
              </p>
              <p>
                Scan status:{" "}
                <span className="font-semibold text-white">
                  {card.imageStatus === "placeholder"
                    ? "No official scan in source catalog yet"
                    : "Official catalog scan available"}
                </span>
              </p>
            </div>
          </article>

          <article className="glass-card rounded-3xl p-4 sm:p-6">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-200">
              Battle notes
            </p>
            <h2 className="mt-2 text-xl font-black text-white">Attacks and play info</h2>
            {card.attacks?.length ? (
              <div className="mt-5 space-y-3">
                {card.attacks.map((attack) => (
                  <div
                    key={`${attack.name}-${attack.damage ?? "effect"}`}
                    className="rounded-2xl border border-white/10 bg-slate-950/45 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-black text-white">{attack.name}</p>
                      {attack.damage ? (
                        <p className="text-sm font-black text-yellow-200">
                          {attack.damage}
                        </p>
                      ) : null}
                    </div>
                    {attack.cost?.length ? (
                      <p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-200">
                        Cost: {attack.cost.join(", ")}
                      </p>
                    ) : null}
                    {attack.effect ? (
                      <p className="mt-2 text-sm text-slate-300">{attack.effect}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-400">
                This source record does not list attacks for this card yet.
              </p>
            )}
          </article>
        </section>
      ) : null}
    </main>
  );
}
