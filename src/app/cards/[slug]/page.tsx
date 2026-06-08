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
import type { TcgCard } from "@/types/pokemon";

/** Cache the catalog shell; slow market enrichment runs after the page is visible. */
export const revalidate = 21600;

async function getCardCatalog(
  slug: string,
  options: { includePublicPriceFallback?: boolean } = {},
): Promise<{ card: TcgCard | null; lookupFailed: boolean }> {
  const localCard = getCardBySlug(slug);

  if (localCard) {
    return { card: localCard, lookupFailed: false };
  }

  try {
    return {
      card: await fetchLiveCardBySlug(slug, options),
      lookupFailed: false,
    };
  } catch (error) {
    console.error(`Live card lookup failed for "${slug}"`, error);
    return { card: null, lookupFailed: true };
  }
}

async function getCardDetail(slug: string): Promise<{
  card: TcgCard | null;
  lookupFailed: boolean;
  gradingEnriched: boolean;
}> {
  const catalog = await getCardCatalog(slug, { includePublicPriceFallback: true });

  if (!catalog.card) {
    return { ...catalog, gradingEnriched: false };
  }

  const { card, gradingEnriched } = await loadCardWithGradingMarket(catalog.card);
  return { card, lookupFailed: false, gradingEnriched };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { card, lookupFailed } = await getCardCatalog(slug, {
    includePublicPriceFallback: false,
  });

  if (!card) {
    return { title: lookupFailed ? "Card Temporarily Unavailable" : "Card Not Found" };
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
      className={`min-w-0 overflow-hidden rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3.5 ${
        quiet
          ? "border-white/10 bg-white/[0.035]"
          : "border-white/10 bg-white/[0.045]"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 sm:text-[11px] sm:tracking-[0.1em]">
        {label}
      </p>
      <p className="mt-1.5 min-w-0 break-words text-[0.86rem] font-semibold leading-snug text-white sm:text-[0.98rem]">
        {value}
      </p>
    </div>
  );
}

function CardLookupUnavailable() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-3 py-5 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
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
        <span className="text-yellow-100">Lookup unavailable</span>
      </nav>

      <section className="route-hero relative overflow-hidden border-2 border-yellow-200/60 p-4 shadow-[0_0_0_3px_#050816,10px_10px_0_rgba(0,0,0,0.38)] sm:p-8 lg:p-10">
        <span className="pixel-cloud left-[8%] top-[10%]" />
        <span className="pixel-cloud pixel-cloud-small right-[12%] top-[14%]" />

        <div className="relative z-10 max-w-3xl space-y-4 lg:space-y-6">
          <span className="premium-kicker max-sm:w-full max-sm:justify-center">
            Live catalog timeout
          </span>
          <h1 className="section-title pokemon-display-title mb-4 max-w-4xl text-[2rem] text-white sm:mb-5 sm:text-6xl">
            This card is temporarily unavailable.
          </h1>
          <p className="premium-hero-copy max-w-2xl p-3.5 text-[0.86rem] leading-7 sm:p-4 sm:text-base sm:leading-7">
            The Pokemon TCG catalog did not respond in time. The app is still running, and this
            card can be opened again once the live catalog recovers.
          </p>
          <div className="flex flex-wrap gap-2 pt-1 sm:gap-3 sm:pt-0">
            <Link
              href="/search"
              className="trainer-button flex-1 bg-blue-500 px-5 py-3 text-center text-sm font-bold text-white sm:flex-none"
            >
              Back to Search
            </Link>
            <Link
              href="/"
              className="pixel-secondary-button flex-1 px-5 py-3 text-center text-sm font-bold sm:flex-none"
            >
              Main Page
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { card, lookupFailed, gradingEnriched } = await getCardDetail(slug);

  if (!card) {
    if (lookupFailed) {
      return <CardLookupUnavailable />;
    }

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
    <main className="app-main mx-auto flex min-h-screen w-full max-w-[92rem] flex-col">
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

      <section className="grid items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        <aside className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-5 sm:p-6 lg:self-start">
          <div className="absolute left-0 top-10 hidden h-32 w-32 rounded-full border-[12px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-20 sm:block lg:-left-10" />
          <div className="absolute right-5 top-5">
            <div className="energy-orbit scale-75" />
          </div>
          <div className="relative mx-auto aspect-[0.72/1] w-full max-w-[10.75rem] overflow-hidden rounded-2xl border border-yellow-200/30 bg-gradient-to-br from-slate-950 via-[#091737] to-slate-950 shadow-2xl shadow-blue-950/35 sm:max-w-[16.5rem] lg:max-w-[17.25rem]">
            <div className="absolute inset-x-8 top-6 h-16 rounded-full bg-yellow-200/10 blur-xl" />
            <Image
              src={card.image}
              alt={displayName}
              fill
              priority
              sizes="(max-width: 640px) 172px, (max-width: 1024px) 82vw, 276px"
              className="object-contain p-2.5 drop-shadow-2xl sm:p-4"
            />
          </div>
          <div className="relative mt-5 flex flex-wrap justify-center gap-2 sm:mt-6">
            <span className="type-chip max-w-full px-2.5 py-1 text-center text-[11px] font-bold leading-snug sm:px-3 sm:py-1.5 sm:text-xs">
              {card.languageLabel}
            </span>
            <span className="type-chip max-w-full px-2.5 py-1 text-center text-[11px] font-bold leading-snug sm:px-3 sm:py-1.5 sm:text-xs">
              #{card.collectorNumber}
            </span>
            <span className="type-chip max-w-full px-2.5 py-1 text-center text-[11px] font-bold leading-snug sm:px-3 sm:py-1.5 sm:text-xs">
              {typeLabel}
            </span>
          </div>
        </aside>

        <div className="grid gap-4 sm:gap-5">
          <section className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-5 sm:p-7">
            <div className="absolute bottom-0 right-0 h-1 w-2/3 bg-gradient-to-r from-transparent via-yellow-300/50 to-blue-400/50" />
            <div className="grid gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(15rem,18rem)] xl:items-start">
              <div className="relative min-w-0">
                <p className="break-words text-[11px] font-bold uppercase tracking-[0.08em] text-yellow-200 sm:text-sm sm:tracking-[0.11em]">
                  {displaySetName} / {card.languageLabel}
                </p>
                <h1 className="mt-1.5 max-w-4xl break-words text-2xl font-black leading-tight tracking-normal text-white sm:mt-2 sm:text-5xl lg:text-[3.35rem]">
                  {displayName}
                </h1>
                {card.language !== "en" && card.englishName?.trim() ? (
                  <p className="mt-1.5 text-sm leading-5 text-slate-300 sm:mt-2 sm:text-base sm:leading-6">
                    English: {card.englishName}
                  </p>
                ) : null}
              </div>
              <div className="relative flex flex-col items-start gap-1.5 rounded-xl border border-blue-300/30 bg-blue-500/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-3.5 xl:block xl:text-right">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-blue-200 sm:text-xs sm:tracking-[0.11em]">
                    Market
                  </p>
                  {card.priceConsensus ? (
                    <p className="mt-1 hidden text-xs leading-5 text-blue-100/80 sm:block">
                      {card.priceConsensus.sourceCount} sources / {Math.round(card.priceConsensus.confidenceScore * 100)}%
                    </p>
                  ) : null}
                </div>
                <ClientPrice
                  amountUsd={card.marketPriceUsd}
                  className="block max-w-full break-words text-2xl font-semibold leading-none text-blue-200 sm:mt-1.5 sm:text-4xl"
                />
              </div>
            </div>

            <div className="relative mt-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-6">
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
        liveMarketPrefetched={gradingEnriched}
      />

      {card.language !== "en" || card.attacks?.length ? (
        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
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

    </main>
  );
}
