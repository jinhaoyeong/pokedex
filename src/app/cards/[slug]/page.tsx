import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ClientPrice } from "@/components/client-price";
import { GradedMarketPanel } from "@/components/card/graded-market-panel";
import { AddToPortfolioButton } from "@/components/portfolio/add-to-portfolio-button";
import { getCardBySlug, getCards } from "@/lib/cards";
import { fetchLiveCardBySlug } from "@/lib/pokemon-tcg-api";

/** Cache the catalog shell; slow market enrichment runs after the page is visible. */
export const revalidate = 21600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = getCardBySlug(slug) ?? (await fetchLiveCardBySlug(slug, {
    includePublicPriceFallback: false,
  }));

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
  const card = getCardBySlug(slug) ?? (await fetchLiveCardBySlug(slug, {
    includePublicPriceFallback: false,
  }));

  if (!card) {
    notFound();
  }

  const typeLabel = card.types.join(", ") || "Type pending";
  const displayName =
    card.language !== "en" && card.localizedName?.trim()
      ? card.localizedName
      : card.name;
  const displaySetName =
    card.language !== "en" && card.setLocalizedName?.trim()
      ? card.setLocalizedName
      : card.setName;
  const setSizeLabel =
    card.setPrintedTotal ?? card.setTotal
      ? `${card.setPrintedTotal ?? "?"}/${card.setTotal ?? card.setPrintedTotal}`
      : "Not listed";
  const cardFacts = [
    { label: "Set", value: card.setCode },
    { label: "No.", value: `#${card.collectorNumber}` },
    { label: "Rarity", value: card.rarity },
    { label: "HP", value: card.hp && card.hp !== "-" ? card.hp : "N/A" },
    { label: "Type", value: typeLabel },
    { label: "Artist", value: card.artist },
    { label: "Stage", value: card.stage ?? "Not listed" },
    {
      label: "Dex",
      value: card.dexIds?.length ? card.dexIds.map((id) => `#${id}`).join(", ") : "Not listed",
    },
    { label: "Set size", value: setSizeLabel },
  ];
  const localizedFacts = [
    { label: "Local name", value: card.localizedName ?? card.name },
    { label: "English name", value: card.englishName ?? "Unavailable" },
    { label: "Local set", value: card.setLocalizedName ?? card.setName },
    { label: "English set", value: card.setEnglishName ?? "Unavailable" },
    {
      label: "Scan",
      value: card.imageStatus === "placeholder" ? "Pending" : "Official",
    },
  ];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[90rem] flex-col gap-4 px-2.5 py-3 sm:gap-5 sm:px-8 sm:py-6 lg:px-10">
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-400 sm:gap-3 sm:text-sm">
        <Link
          href="/search"
          className="rounded-full border border-white/10 px-3 py-1 hover:border-yellow-200/40 hover:text-white"
        >
          Card Dex
        </Link>
        <span>/</span>
        <span className="text-yellow-100">{displayName}</span>
      </div>

      <section className="grid items-start gap-3 lg:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)]">
        <div className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/20 p-3 lg:self-start">
          <div className="absolute -left-14 top-8 h-24 w-24 rounded-full border-[10px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-20" />
          <div className="absolute right-5 top-5">
            <div className="energy-orbit scale-75" />
          </div>
          <div className="relative mx-auto aspect-[0.72/1] w-full max-w-[11.5rem] overflow-hidden rounded-2xl border border-yellow-200/20 bg-gradient-to-br from-slate-950 via-[#091737] to-slate-950 shadow-xl shadow-blue-950/35 sm:max-w-[13.75rem] lg:max-w-[14.5rem]">
            <div className="absolute inset-x-8 top-4 h-10 rounded-full bg-yellow-200/10 blur-xl" />
            <Image
              src={card.image}
              alt={displayName}
              fill
              priority
              sizes="(max-width: 768px) 78vw, 232px"
              className="object-contain p-2.5 drop-shadow-2xl"
            />
          </div>
          <div className="relative mt-3 flex flex-wrap justify-center gap-1.5">
            <span className="type-chip px-2.5 py-1 text-xs font-bold">
              {card.languageLabel}
            </span>
            <span className="type-chip px-2.5 py-1 text-xs font-bold">
              #{card.collectorNumber}
            </span>
            <span className="type-chip px-2.5 py-1 text-xs font-bold">
              {typeLabel}
            </span>
          </div>
        </div>

        <div className="grid gap-3">
          <section className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/20 p-3 sm:p-4">
            <div className="absolute bottom-0 right-0 h-1 w-2/3 bg-gradient-to-r from-transparent via-yellow-300/50 to-blue-400/50" />
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="relative">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-yellow-200">
                  {displaySetName} / {card.languageLabel}
                </p>
                <h1 className="mt-1.5 text-2xl font-black tracking-normal text-white sm:text-4xl">
                  {displayName}
                </h1>
                {card.language !== "en" && card.englishName?.trim() ? (
                  <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                    English: {card.englishName}
                  </p>
                ) : null}
              </div>
              <div className="relative rounded-xl border border-blue-300/25 bg-blue-500/10 px-3 py-2.5 lg:min-w-56 lg:text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-200">
                  Market
                </p>
                <ClientPrice
                  amountUsd={card.marketPriceUsd}
                  className="mt-1 block text-2xl font-semibold text-blue-300 sm:text-3xl"
                />
                {card.priceConsensus ? (
                  <p className="mt-1 text-xs text-blue-100/80">
                    {card.priceConsensus.sourceCount} sources / {Math.round(card.priceConsensus.confidenceScore * 100)}%
                  </p>
                ) : null}
              </div>
            </div>

            <div className="relative mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 xl:grid-cols-6">
              {cardFacts.slice(0, 6).map((fact) => (
                <div key={fact.label} className="rounded-xl border border-white/10 bg-white/4 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{fact.label}</p>
                  <p className="mt-1 truncate font-semibold text-white" title={fact.value}>{fact.value}</p>
                </div>
              ))}
            </div>
          </section>

          <AddToPortfolioButton card={card} />
        </div>
      </section>

      <GradedMarketPanel
        key={card.slug}
        card={card}
        liveMarketPrefetched={false}
      />

      {card.language !== "en" || card.attacks?.length ? (
        <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          {card.language !== "en" ? (
            <article className="glass-card rounded-2xl p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">Language data</h2>
                <span className="type-chip px-2.5 py-1 text-xs font-bold">{card.languageLabel}</span>
              </div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {localizedFacts.map((fact) => (
                  <div key={fact.label} className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{fact.label}</p>
                    <p className="mt-1 truncate font-semibold text-white" title={fact.value}>{fact.value}</p>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {card.attacks?.length ? (
            <article className="glass-card rounded-2xl p-3 sm:p-4">
              <h2 className="text-base font-semibold text-white">Attacks</h2>
              <div className="mt-3 grid gap-2">
                {card.attacks.map((attack) => (
                  <div
                    key={`${attack.name}-${attack.damage ?? "effect"}`}
                    className="rounded-xl border border-white/10 bg-slate-950/35 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold text-white">{attack.name}</p>
                      {attack.damage ? (
                        <p className="text-sm font-bold text-yellow-200">
                          {attack.damage}
                        </p>
                      ) : null}
                    </div>
                    {attack.cost?.length ? (
                      <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-blue-200">
                        {attack.cost.join(", ")}
                      </p>
                    ) : null}
                    {attack.effect ? (
                      <p className="mt-2 text-sm leading-5 text-slate-300">{attack.effect}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {card.language === "en" && !card.attacks?.length ? (
            <article className="glass-card rounded-2xl p-3 text-sm text-slate-400 sm:p-4">
              No additional battle text is available for this source record.
            </article>
          ) : null}
        </section>
      ) : null}

      <section className="glass-card rounded-2xl p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">Card facts</h2>
          <p className="text-xs text-slate-500">{card.supertype}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {cardFacts.map((fact) => (
            <div key={fact.label} className="rounded-xl border border-white/10 bg-white/4 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{fact.label}</p>
              <p className="mt-1 truncate font-semibold text-white" title={fact.value}>{fact.value}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
