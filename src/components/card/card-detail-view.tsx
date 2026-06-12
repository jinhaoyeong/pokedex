import Image from "next/image";
import Link from "next/link";

import { CardCorrectionPanel } from "@/components/card/card-correction-panel";
import { CardDataConfidence } from "@/components/card/card-data-confidence";
import { CardGradingMarketProvider } from "@/components/card/card-grading-market-context";
import { CardMarketPrice } from "@/components/card/card-market-price";
import { GradedMarketPanel } from "@/components/card/graded-market-panel";
import { AddToPortfolioButton } from "@/components/portfolio/add-to-portfolio-button";
import type { TcgCard } from "@/types/pokemon";

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
      className={`min-w-0 overflow-hidden rounded-xl border px-3 py-2 sm:px-3.5 sm:py-2.5 ${
        quiet
          ? "border-white/10 bg-white/[0.035]"
          : "border-white/10 bg-white/[0.045]"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 min-w-0 break-words text-[0.84rem] font-semibold leading-snug text-white sm:text-[0.92rem]">
        {value}
      </p>
    </div>
  );
}

function MarketPriceBlock({ card, className = "" }: { card: TcgCard; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-blue-300/30 bg-blue-500/10 px-4 py-3 ${className}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-blue-200">Market</p>
      <CardMarketPrice
        key={card.slug}
        card={card}
        prefetchEnriched
        className="mt-1 block max-w-full break-words text-2xl font-semibold leading-none text-blue-100 xl:text-3xl"
      />
    </div>
  );
}

export function CardDetailView({ card }: { card: TcgCard }) {
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
  ];
  const extendedFacts = [
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
  const showLanguageStrip = card.language !== "en";
  const showAttacks = Boolean(card.attacks?.length);

  return (
    <CardGradingMarketProvider key={card.slug} card={card}>
      <main className="app-main mx-auto flex min-h-screen w-full max-w-[88rem] flex-col gap-5 sm:gap-6">
        <nav
          aria-label="Card detail breadcrumb"
          className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-300"
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

        {/* Hero: image | identity | action rail (desktop) */}
        <section className="grid items-start gap-5 lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] xl:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)_minmax(15rem,18rem)] xl:gap-6">
          <aside className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-4 sm:p-5 xl:sticky xl:top-4 xl:self-start">
            <div className="relative mx-auto aspect-[0.716/1] w-full max-w-[11.5rem] overflow-hidden rounded-2xl border border-yellow-200/25 bg-slate-950/40 shadow-2xl shadow-blue-950/35 sm:max-w-[14rem] xl:max-w-none">
              <Image
                src={card.image}
                alt={displayName}
                fill
                priority
                sizes="(max-width: 1280px) 176px, 220px"
                className="object-contain drop-shadow-2xl"
              />
            </div>
            <div className="relative mt-4 flex flex-wrap justify-center gap-1.5">
              <span className="result-chip">{card.languageLabel}</span>
              <span className="result-chip">#{card.collectorNumber}</span>
              <span className="result-chip">{card.rarity}</span>
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            <section className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-5 sm:p-6">
              <div className="absolute bottom-0 right-0 h-1 w-2/3 bg-gradient-to-r from-transparent via-yellow-300/50 to-blue-400/50" />
              <div className="relative space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-yellow-200">
                      {displaySetName} / {card.languageLabel}
                    </p>
                    <h1 className="mt-1 max-w-3xl break-words text-2xl font-black leading-tight text-white sm:text-4xl xl:text-[2.35rem]">
                      {displayName}
                    </h1>
                    {card.language !== "en" && card.englishName?.trim() ? (
                      <p className="mt-1.5 text-sm leading-5 text-slate-300 sm:text-base">
                        English: {card.englishName}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 xl:hidden">
                    <MarketPriceBlock card={card} className="min-w-[10rem]" />
                  </div>
                </div>

                <CardDataConfidence card={card} />

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 xl:grid-cols-6">
                  {cardFacts.map((fact) => (
                    <DetailFact key={fact.label} {...fact} />
                  ))}
                </div>

                <div className="hidden grid-cols-3 gap-2 xl:grid">
                  {extendedFacts.map((fact) => (
                    <DetailFact key={fact.label} {...fact} quiet />
                  ))}
                </div>

                {showLanguageStrip ? (
                  <div className="hidden rounded-xl border border-white/10 bg-white/[0.03] p-3 xl:block">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-400">
                        Language data
                      </p>
                      <span className="type-chip px-2 py-1 text-[10px] font-bold">
                        {card.languageLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                      {localizedFacts.map((fact) => (
                        <DetailFact key={fact.label} {...fact} quiet />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <div className="xl:hidden">
              <AddToPortfolioButton card={card} layout="inline" />
            </div>
          </div>

          <aside className="hidden min-w-0 space-y-4 xl:sticky xl:top-4 xl:block xl:self-start">
            <MarketPriceBlock card={card} />
            <AddToPortfolioButton card={card} layout="rail" />
          </aside>
        </section>

        <GradedMarketPanel key={card.slug} card={card} liveMarketPrefetched />

        {showLanguageStrip || showAttacks ? (
          <section className="grid gap-4 xl:hidden">
            {showLanguageStrip ? (
              <article className="glass-card rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">
                    Language data
                  </h2>
                  <span className="type-chip px-3 py-1.5 text-xs font-bold">{card.languageLabel}</span>
                </div>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {localizedFacts.map((fact) => (
                    <DetailFact key={fact.label} {...fact} quiet />
                  ))}
                </div>
              </article>
            ) : null}

            {showAttacks ? (
              <article className="glass-card rounded-2xl p-4 sm:p-5">
                <h2 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">Attacks</h2>
                <div className="mt-4 grid gap-3">
                  {card.attacks!.map((attack) => (
                    <div
                      key={`${attack.name}-${attack.damage ?? "effect"}`}
                      className="rounded-xl border border-white/10 bg-slate-950/35 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="break-words text-base font-semibold leading-snug text-white">
                          {attack.name}
                        </p>
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
                        <p className="mt-3 text-sm leading-6 text-slate-300">{attack.effect}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
            ) : null}
          </section>
        ) : null}

        <CardCorrectionPanel slug={card.slug} />
      </main>
    </CardGradingMarketProvider>
  );
}
