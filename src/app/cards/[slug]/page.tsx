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

function DetailFact({
  label,
  value,
  quiet = false,
}: {
  label: string;
  value: string;
  quiet?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border px-3.5 py-3 ${
        quiet
          ? "border-white/10 bg-slate-950/35"
          : "border-yellow-200/18 bg-white/5"
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
        {label}
      </p>
      <p className="mt-1.5 break-words text-sm font-semibold leading-snug text-white sm:text-[0.95rem]">
        {value}
      </p>
    </div>
  );
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
    <main className="mx-auto flex min-h-screen w-full max-w-[92rem] flex-col gap-5 px-3 py-4 sm:gap-6 sm:px-8 sm:py-7 lg:px-10">
      <nav
        aria-label="Card detail breadcrumb"
        className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-300 sm:gap-3"
      >
        <Link
          href="/search"
          className="inline-flex min-h-9 items-center justify-center rounded-xl border border-yellow-200/25 bg-slate-950/45 px-3.5 py-2 text-center leading-none text-yellow-100 transition hover:border-yellow-200/55 hover:text-white"
        >
          Card Dex
        </Link>
        <span className="text-slate-500">/</span>
        <span className="min-w-0 break-words text-yellow-100">{displayName}</span>
      </nav>

      <section className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        <aside className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-4 sm:p-5 lg:self-start">
          <div className="absolute -left-16 top-10 h-32 w-32 rounded-full border-[12px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-20" />
          <div className="absolute right-5 top-5">
            <div className="energy-orbit scale-75" />
          </div>
          <div className="relative mx-auto aspect-[0.72/1] w-full max-w-[14.75rem] overflow-hidden rounded-2xl border border-yellow-200/30 bg-gradient-to-br from-slate-950 via-[#091737] to-slate-950 shadow-2xl shadow-blue-950/35 sm:max-w-[16.5rem] lg:max-w-[17.25rem]">
            <div className="absolute inset-x-8 top-6 h-16 rounded-full bg-yellow-200/10 blur-xl" />
            <Image
              src={card.image}
              alt={displayName}
              fill
              priority
              sizes="(max-width: 1024px) 82vw, 276px"
              className="object-contain p-3 drop-shadow-2xl sm:p-4"
            />
          </div>
          <div className="relative mt-4 flex flex-wrap justify-center gap-2">
            <span className="type-chip max-w-full px-3 py-1.5 text-center text-xs font-bold leading-snug">
              {card.languageLabel}
            </span>
            <span className="type-chip max-w-full px-3 py-1.5 text-center text-xs font-bold leading-snug">
              #{card.collectorNumber}
            </span>
            <span className="type-chip max-w-full px-3 py-1.5 text-center text-xs font-bold leading-snug">
              {typeLabel}
            </span>
          </div>
        </aside>

        <div className="grid gap-4">
          <section className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-4 sm:p-6">
            <div className="absolute bottom-0 right-0 h-1 w-2/3 bg-gradient-to-r from-transparent via-yellow-300/50 to-blue-400/50" />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(15rem,18rem)] xl:items-start">
              <div className="relative min-w-0">
                <p className="break-words text-xs font-bold uppercase tracking-[0.11em] text-yellow-200 sm:text-sm">
                  {displaySetName} / {card.languageLabel}
                </p>
                <h1 className="mt-2 max-w-4xl break-words text-3xl font-black leading-tight tracking-normal text-white sm:text-5xl lg:text-[3.35rem]">
                  {displayName}
                </h1>
                {card.language !== "en" && card.englishName?.trim() ? (
                  <p className="mt-2 text-sm leading-6 text-slate-300 sm:text-base">
                    English: {card.englishName}
                  </p>
                ) : null}
              </div>
              <div className="relative rounded-xl border border-blue-300/30 bg-blue-500/10 px-4 py-3.5 xl:text-right">
                <p className="text-xs font-bold uppercase tracking-[0.11em] text-blue-200">
                  Market
                </p>
                <ClientPrice
                  amountUsd={card.marketPriceUsd}
                  className="mt-1.5 block text-3xl font-semibold leading-none text-blue-200 sm:text-4xl"
                />
                {card.priceConsensus ? (
                  <p className="mt-2 text-sm leading-5 text-blue-100/80">
                    {card.priceConsensus.sourceCount} sources / {Math.round(card.priceConsensus.confidenceScore * 100)}%
                  </p>
                ) : null}
              </div>
            </div>

            <div className="relative mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              {cardFacts.slice(0, 6).map((fact) => (
                <DetailFact key={fact.label} {...fact} />
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
            <article className="glass-card rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">Language data</h2>
                <span className="type-chip px-3 py-1.5 text-xs font-bold">{card.languageLabel}</span>
              </div>
              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {localizedFacts.map((fact) => (
                  <DetailFact key={fact.label} {...fact} quiet />
                ))}
              </div>
            </article>
          ) : null}

          {card.attacks?.length ? (
            <article className="glass-card rounded-2xl p-4 sm:p-5">
              <h2 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">Attacks</h2>
              <div className="mt-4 grid gap-3">
                {card.attacks.map((attack) => (
                  <div
                    key={`${attack.name}-${attack.damage ?? "effect"}`}
                    className="rounded-xl border border-white/10 bg-slate-950/35 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="break-words text-base font-semibold leading-snug text-white">{attack.name}</p>
                      {attack.damage ? (
                        <p className="rounded-lg border border-yellow-200/20 bg-yellow-300/10 px-2.5 py-1 text-sm font-bold text-yellow-100">
                          {attack.damage}
                        </p>
                      ) : null}
                    </div>
                    {attack.cost?.length ? (
                      <p className="mt-2 text-xs font-bold uppercase tracking-[0.11em] text-blue-200">
                        {attack.cost.join(", ")}
                      </p>
                    ) : null}
                    {attack.effect ? (
                      <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-[0.95rem]">{attack.effect}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {card.language === "en" && !card.attacks?.length ? (
            <article className="glass-card rounded-2xl p-4 text-sm leading-6 text-slate-300 sm:p-5">
              No additional battle text is available for this source record.
            </article>
          ) : null}
        </section>
      ) : null}

      <section className="glass-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">Card facts</h2>
          <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-slate-300">
            {card.supertype}
          </p>
        </div>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
          {cardFacts.map((fact) => (
            <DetailFact key={fact.label} {...fact} quiet />
          ))}
        </div>
      </section>
    </main>
  );
}
