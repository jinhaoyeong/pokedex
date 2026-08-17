"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { CardCorrectionPanel } from "@/components/card/card-correction-panel";
import { CardDataConfidence } from "@/components/card/card-data-confidence";
import { CardDetailFacts } from "@/components/card/card-detail-facts";
import { CardDetailImage } from "@/components/card/card-detail-image";
import { CardFinishSwitcher } from "@/components/card/card-finish-switcher";
import { CardGradingMarketProvider } from "@/components/card/card-grading-market-context";
import { CardMarketPrice } from "@/components/card/card-market-price";
import { GradedMarketPanel } from "@/components/card/graded-market-panel";
import { AddToPortfolioButton } from "@/components/portfolio/add-to-portfolio-button";
import { needsCatalogFactHydration } from "@/lib/card-catalog-facts";
import { applySelectedFinish, inferPrimaryFinish, parseCardFinishId } from "@/lib/card-finish";
import { buildSetSearchHref } from "@/lib/set-search-href";
import type { CardFinishId, TcgCard } from "@/types/pokemon";

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          {eyebrow}
        </p>
        <h2 className="mt-1 font-[var(--font-game-copy)] text-xl font-semibold text-white sm:text-2xl">
          {title}
        </h2>
      </div>
      <p className="max-w-xl text-sm leading-6 text-slate-400 sm:text-right">{description}</p>
    </div>
  );
}

export function CardDetailView({ card }: { card: TcgCard }) {
  const availableFinishes = (card.finishMarkets ?? []).map((market) => market.id);
  const [selectedFinish, setSelectedFinish] = useState<CardFinishId>(() => {
    const requested =
      typeof window === "undefined"
        ? null
        : parseCardFinishId(new URLSearchParams(window.location.search).get("finish"));
    if (requested && (availableFinishes.length === 0 || availableFinishes.includes(requested))) {
      return requested;
    }
    return card.finish ?? inferPrimaryFinish(card.rarity, availableFinishes, card.englishName ?? card.name);
  });
  const displayCard = useMemo(
    () => applySelectedFinish(card, selectedFinish),
    [card, selectedFinish],
  );
  const setHref = buildSetSearchHref(card);
  const typeLabel = displayCard.types.join(", ") || "Type pending";
  const displayName =
    displayCard.language !== "en" && displayCard.localizedName?.trim()
      ? displayCard.localizedName
      : displayCard.name;
  const displaySetName =
    displayCard.language !== "en" && displayCard.setLocalizedName?.trim()
      ? displayCard.setLocalizedName
      : displayCard.setName;
  const setSizeLabel =
    displayCard.setPrintedTotal ?? displayCard.setTotal
      ? `${displayCard.setPrintedTotal ?? "?"}/${displayCard.setTotal ?? displayCard.setPrintedTotal}`
      : "Not listed";
  const primaryFacts = [
    { label: "Set", value: displayCard.setCode, href: setHref },
    { label: "No.", value: `#${displayCard.collectorNumber}` },
    { label: "Rarity", value: displayCard.rarity },
    { label: "HP", value: displayCard.hp && displayCard.hp !== "-" ? displayCard.hp : "N/A" },
    { label: "Type", value: typeLabel },
  ];
  const secondaryFacts = [
    { label: "Artist", value: displayCard.artist },
    { label: "Stage", value: displayCard.stage ?? "Not listed" },
    {
      label: "Dex",
      value: displayCard.dexIds?.length
        ? displayCard.dexIds.map((id) => `#${id}`).join(", ")
        : "Not listed",
    },
    { label: "Set size", value: setSizeLabel },
    ...(displayCard.language !== "en"
      ? [
          { label: "Local set", value: displayCard.setLocalizedName ?? displayCard.setName, quiet: true },
          { label: "English set", value: displayCard.setEnglishName ?? "Unavailable", quiet: true },
          {
            label: "Scan",
            value: displayCard.imageStatus === "placeholder" ? "Pending" : "Official",
            quiet: true,
          },
        ]
      : []),
  ];
  const mobileSummary = [
    displayCard.setCode,
    `#${displayCard.collectorNumber}`,
    displayCard.rarity,
    displayCard.hp && displayCard.hp !== "-" ? `${displayCard.hp} HP` : null,
    typeLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const showAttacks = Boolean(card.attacks?.length);
  const legalityItems = [
    { label: "Standard", active: card.legalities?.standard },
    { label: "Expanded", active: card.legalities?.expanded },
  ];

  return (
    <CardGradingMarketProvider key={`${card.slug}:${selectedFinish}`} card={displayCard}>
      <main className="app-main mx-auto flex w-full max-w-[96rem] flex-col gap-8 pb-8 sm:gap-10 sm:pb-10">
        <nav
          aria-label="Card detail breadcrumb"
          className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-300 sm:gap-3"
        >
          <Link
            href="/search"
            className="breadcrumb-link"
          >
            Card Dex
          </Link>
          <span className="text-slate-500">/</span>
          <Link href={setHref} className="breadcrumb-link min-w-0 break-words text-slate-300">
            {displaySetName}
          </Link>
          <span className="text-slate-500">/</span>
          <span className="min-w-0 break-words text-[var(--text)]">{displayName}</span>
        </nav>

        <section className="glass-card relative overflow-hidden rounded-3xl">
          <div className="relative grid items-start gap-5 p-3 sm:p-5 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)] lg:gap-7 lg:p-7 xl:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)_minmax(19rem,22rem)] xl:items-start xl:gap-8">
            <aside className="flex flex-col gap-3 lg:sticky lg:top-5">
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start lg:block">
                <CardDetailImage
                  src={card.image}
                  alt={displayName}
                  priority
                  sizes="(max-width: 640px) 70vw, (max-width: 1024px) 120px, 320px"
                  className="relative aspect-[0.716/1] w-[min(70vw,14rem)] shrink-0 rounded-xl border border-white/10 bg-black/40 shadow-lg shadow-black/40 sm:w-[7.5rem] lg:w-full lg:rounded-2xl lg:shadow-2xl"
                />
                <div className="min-w-0 flex-1 max-sm:text-center lg:hidden">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
                    <Link href={setHref} className="hover:text-white hover:underline">
                      {displaySetName}
                    </Link>{" "}
                    / {card.languageLabel}
                  </p>
                  <h1 className="mt-0.5 break-words text-xl font-black leading-tight text-white">
                    {displayName}
                  </h1>
                  {card.language !== "en" && card.englishName?.trim() ? (
                    <p className="mt-0.5 text-xs leading-5 text-slate-300">{card.englishName}</p>
                  ) : null}
                </div>
              </div>
            </aside>

            <div className="min-w-0 xl:pt-0">
              <div className="hidden lg:block">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                  <Link href={setHref} className="hover:text-white hover:underline">
                    {displaySetName}
                  </Link>{" "}
                  / {card.languageLabel}
                </p>
                <h1 className="mt-2 max-w-3xl break-words text-4xl font-black leading-[1.05] tracking-tight text-white xl:text-5xl">
                  {displayName}
                </h1>
                {card.language !== "en" && card.englishName?.trim() ? (
                  <p className="mt-3 text-base leading-6 text-slate-300">
                    English name: {card.englishName}
                  </p>
                ) : null}
              </div>

              <div className="mt-1 border-t border-white/10 pt-3 lg:mt-6 lg:pt-5">
                <div className="mb-3 flex items-center justify-between gap-3 sm:mb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                      Catalog record
                    </p>
                    <p className="mt-1 text-sm text-slate-300">Identity and print details</p>
                  </div>
                  <span className="hidden rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-200 sm:inline-flex">
                    {needsCatalogFactHydration(displayCard) ? "Refreshing" : "Catalog"}
                  </span>
                </div>
                <CardDetailFacts
                  summaryLine={mobileSummary}
                  primaryFacts={primaryFacts}
                  secondaryFacts={secondaryFacts}
                />
                <CardFinishSwitcher
                  card={card}
                  liveCard={displayCard}
                  selected={selectedFinish}
                  onSelect={setSelectedFinish}
                />
              </div>

              <div className="mt-4 hidden border-t border-white/10 pt-4 lg:block">
                <CardDataConfidence card={card} />
              </div>
              <div className="mt-4 border-t border-white/10 pt-4 lg:hidden">
                <CardDataConfidence card={card} />
              </div>
            </div>

            <aside className="flex min-w-0 flex-col gap-3 lg:col-start-2 xl:col-start-3 xl:row-start-1 xl:self-start">
              <div className="rounded-2xl border border-[rgba(255,81,71,0.22)] bg-[linear-gradient(160deg,rgba(255,81,71,0.07),rgba(13,14,19,0.92))] p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                      Raw market value
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      {displayCard.finishMarkets && displayCard.finishMarkets.length > 1
                        ? "Selected print finish"
                        : "Live blended estimate"}
                    </p>
                  </div>
                  <a
                    href="#market-intelligence"
                    className="rounded-full border border-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    Analytics
                  </a>
                </div>
                <div className="mt-4 border-t border-white/10 pt-4">
                  <CardMarketPrice
                    key={`${displayCard.slug}:${selectedFinish}`}
                    card={displayCard}
                    prefetchEnriched
                    className="figure-mono block max-w-full break-words text-4xl font-semibold leading-none text-[var(--text)] sm:text-5xl"
                  />
                </div>
              </div>

              <div className="info-box">
                <AddToPortfolioButton card={displayCard} embedded />
              </div>
            </aside>
          </div>
        </section>

        <section id="market-intelligence" className="scroll-mt-6 space-y-4 sm:space-y-5">
          <SectionHeading
            eyebrow="Market intelligence"
            title="Price, grades and population"
            description="Compare the raw market, graded values, sold evidence, price movement and certification counts in one workspace."
          />
          <GradedMarketPanel key={`${displayCard.slug}:${selectedFinish}`} card={displayCard} liveMarketPrefetched />
        </section>

        <section className="space-y-4 sm:space-y-5">
          <SectionHeading
            eyebrow="Card record"
            title="Gameplay and provenance"
            description="Printed attacks, format legality and the catalog sources used to identify this exact card."
          />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.55fr)]">
            <article className="glass-card rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <h3 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">
                  Attacks
                </h3>
                <span className="text-xs font-semibold text-slate-500">
                  {showAttacks ? `${card.attacks!.length} listed` : "None listed"}
                </span>
              </div>
              {showAttacks ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
                          <p className="premium-badge text-sm font-semibold normal-case tracking-normal">
                            {attack.damage}
                          </p>
                        ) : null}
                      </div>
                      {attack.cost?.length ? (
                        <p className="mt-2 text-xs font-bold uppercase tracking-[0.11em] text-[var(--text-faint)]">
                          {attack.cost.join(", ")}
                        </p>
                      ) : null}
                      {attack.effect ? (
                        <p className="mt-3 text-sm leading-6 text-slate-300">{attack.effect}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-white/10 bg-slate-950/30 p-4 text-sm leading-6 text-slate-400">
                  This catalog record does not list printed attacks.
                </p>
              )}
            </article>

            <aside className="glass-card rounded-2xl p-4 sm:p-5">
              <h3 className="font-[var(--font-game-copy)] text-lg font-semibold text-white">
                Catalog notes
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {legalityItems.map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                      {item.label}
                    </p>
                    <p className={`mt-1 text-sm font-semibold ${item.active ? "text-emerald-200" : "text-slate-300"}`}>
                      {item.active ? "Legal" : "Not listed"}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  Identity sources
                </p>
                <div className="mt-2 space-y-2">
                  {card.sources.slice(0, 4).map((source, index) => (
                    <div
                      key={`${source.source}-${index}`}
                      className="rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-slate-200">{source.source}</p>
                      {source.note ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{source.note}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </section>

        <CardCorrectionPanel slug={card.slug} />
      </main>
    </CardGradingMarketProvider>
  );
}
