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
      className={`flex min-h-[3.5rem] min-w-0 flex-col justify-center overflow-hidden rounded-lg border px-2.5 py-2 sm:min-h-[3.75rem] sm:px-3 sm:py-2.5 ${
        quiet
          ? "border-white/10 bg-white/[0.035]"
          : "border-white/10 bg-white/[0.045]"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 line-clamp-2 min-w-0 text-[0.84rem] font-semibold leading-snug text-white sm:text-[0.92rem]">
        {value}
      </p>
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
  const showLanguageData = card.language !== "en";
  const showAttacks = Boolean(card.attacks?.length);
  const detailFacts = showLanguageData ? [...cardFacts, ...localizedFacts] : cardFacts;

  return (
    <CardGradingMarketProvider key={card.slug} card={card}>
    <main className="app-main mx-auto flex w-full max-w-[92rem] flex-col gap-4 pb-6">
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

      <section className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-4 sm:p-5 lg:p-6">
        <div className="absolute bottom-0 right-0 hidden h-1 w-2/3 bg-gradient-to-r from-transparent via-yellow-300/50 to-blue-400/50 sm:block" />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
          <aside className="relative flex flex-col">
            <div className="absolute left-0 top-10 hidden h-32 w-32 rounded-full border-[12px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-20 lg:-left-10 lg:block" />
            <div className="absolute right-0 top-0 lg:right-2">
              <div className="energy-orbit scale-75" />
            </div>
            <div className="relative mx-auto aspect-[0.716/1] w-full max-w-[10.75rem] overflow-hidden rounded-2xl border border-yellow-200/25 bg-slate-950/40 shadow-2xl shadow-blue-950/35 sm:max-w-[16.5rem] lg:mx-0 lg:max-w-none">
              <Image
                src={card.image}
                alt={displayName}
                fill
                priority
                sizes="(max-width: 640px) 172px, (max-width: 1024px) 82vw, 276px"
                className="object-contain drop-shadow-2xl"
              />
            </div>
            <div className="relative mt-5 flex flex-wrap justify-center gap-2 lg:justify-start">
              <span className="result-chip">{card.languageLabel}</span>
              <span className="result-chip">#{card.collectorNumber}</span>
              <span className="result-chip">{card.rarity}</span>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,17rem)] lg:items-start">
              <div className="min-w-0">
                <p className="break-words text-[11px] font-bold uppercase tracking-[0.08em] text-yellow-200 sm:text-sm sm:tracking-[0.11em]">
                  {displaySetName} / {card.languageLabel}
                </p>
                <h1 className="mt-1.5 max-w-4xl break-words text-2xl font-black leading-tight tracking-normal text-white sm:mt-2 sm:text-4xl lg:text-[2.75rem]">
                  {displayName}
                </h1>
                {card.language !== "en" && card.englishName?.trim() ? (
                  <p className="mt-1.5 text-sm leading-5 text-slate-300 sm:mt-2 sm:text-base sm:leading-6">
                    English: {card.englishName}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col justify-center gap-1.5 rounded-xl border border-blue-300/30 bg-blue-500/10 px-3 py-2.5 sm:px-4 sm:py-3.5 lg:text-right">
                <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-blue-200 sm:text-xs sm:tracking-[0.11em]">
                  Market
                </p>
                <CardMarketPrice
                  key={card.slug}
                  card={card}
                  prefetchEnriched
                  className="block max-w-full break-words text-2xl font-semibold leading-none text-blue-200 sm:text-3xl lg:text-4xl"
                />
              </div>
            </div>

            <CardDataConfidence card={card} />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {detailFacts.map((fact) => (
                <DetailFact
                  key={fact.label}
                  {...fact}
                  quiet={showLanguageData && localizedFacts.some((item) => item.label === fact.label)}
                />
              ))}
            </div>

            <div className="border-t border-white/10 pt-3">
              <AddToPortfolioButton card={card} embedded />
            </div>
          </div>
        </div>
      </section>

      <GradedMarketPanel key={card.slug} card={card} liveMarketPrefetched />

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
                  <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-[0.95rem]">
                    {attack.effect}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <CardCorrectionPanel slug={card.slug} />
    </main>
    </CardGradingMarketProvider>
  );
}
