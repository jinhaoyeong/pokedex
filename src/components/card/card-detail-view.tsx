import Link from "next/link";

import { CardCorrectionPanel } from "@/components/card/card-correction-panel";
import { CardDataConfidence } from "@/components/card/card-data-confidence";
import { CardDetailFacts } from "@/components/card/card-detail-facts";
import { CardDetailImage } from "@/components/card/card-detail-image";
import { CardGradingMarketProvider } from "@/components/card/card-grading-market-context";
import { CardMarketPrice } from "@/components/card/card-market-price";
import { GradedMarketPanel } from "@/components/card/graded-market-panel";
import { AddToPortfolioButton } from "@/components/portfolio/add-to-portfolio-button";
import type { TcgCard } from "@/types/pokemon";

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
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-yellow-200">
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
  const typeLabel = card.types.join(", ") || "Type pending";
  const displayName =
    card.language !== "en" && card.localizedName?.trim() ? card.localizedName : card.name;
  const displaySetName =
    card.language !== "en" && card.setLocalizedName?.trim()
      ? card.setLocalizedName
      : card.setName;
  const setSizeLabel =
    card.setPrintedTotal ?? card.setTotal
      ? `${card.setPrintedTotal ?? "?"}/${card.setTotal ?? card.setPrintedTotal}`
      : "Not listed";
  const primaryFacts = [
    { label: "Set", value: card.setCode },
    { label: "No.", value: `#${card.collectorNumber}` },
    { label: "Rarity", value: card.rarity },
    { label: "HP", value: card.hp && card.hp !== "-" ? card.hp : "N/A" },
    { label: "Type", value: typeLabel },
  ];
  const secondaryFacts = [
    { label: "Artist", value: card.artist },
    { label: "Stage", value: card.stage ?? "Not listed" },
    {
      label: "Dex",
      value: card.dexIds?.length ? card.dexIds.map((id) => `#${id}`).join(", ") : "Not listed",
    },
    { label: "Set size", value: setSizeLabel },
    ...(card.language !== "en"
      ? [
          { label: "Local set", value: card.setLocalizedName ?? card.setName, quiet: true },
          { label: "English set", value: card.setEnglishName ?? "Unavailable", quiet: true },
          {
            label: "Scan",
            value: card.imageStatus === "placeholder" ? "Pending" : "Official",
            quiet: true,
          },
        ]
      : []),
  ];
  const mobileSummary = [
    card.setCode,
    `#${card.collectorNumber}`,
    card.rarity,
    card.hp && card.hp !== "-" ? `${card.hp} HP` : null,
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
    <CardGradingMarketProvider key={card.slug} card={card}>
      <main className="app-main mx-auto flex w-full max-w-[96rem] flex-col gap-8 pb-8 sm:gap-10 sm:pb-10">
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
          <span className="text-slate-400">{displaySetName}</span>
          <span className="text-slate-500">/</span>
          <span className="min-w-0 break-words text-yellow-100">{displayName}</span>
        </nav>

        <section className="glass-card relative overflow-hidden rounded-3xl border-yellow-200/25">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_18%_0%,rgba(255,203,5,0.16),transparent_55%),radial-gradient(circle_at_86%_0%,rgba(66,165,255,0.18),transparent_48%)]" />
          <div className="relative grid items-start gap-5 p-3 sm:p-5 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)] lg:gap-7 lg:p-7 xl:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)_minmax(19rem,22rem)] xl:gap-8">
            <aside className="flex flex-col gap-3 lg:sticky lg:top-5">
              <div className="flex items-start gap-3 lg:block">
                <CardDetailImage
                  src={card.image}
                  alt={displayName}
                  priority
                  sizes="(max-width: 640px) 88px, (max-width: 1024px) 120px, 320px"
                  className="relative aspect-[0.716/1] w-[5.5rem] shrink-0 rounded-xl border border-yellow-200/25 bg-slate-950/40 shadow-lg shadow-blue-950/35 sm:w-[7.5rem] lg:w-full lg:rounded-2xl lg:shadow-2xl"
                />
                <div className="min-w-0 flex-1 lg:hidden">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-yellow-200">
                    {displaySetName} / {card.languageLabel}
                  </p>
                  <h1 className="mt-0.5 break-words text-xl font-black leading-tight text-white">
                    {displayName}
                  </h1>
                  {card.language !== "en" && card.englishName?.trim() ? (
                    <p className="mt-0.5 text-xs leading-5 text-slate-300">{card.englishName}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="result-chip">{card.languageLabel}</span>
                    <span className="result-chip">#{card.collectorNumber}</span>
                    <span className="result-chip">{card.rarity}</span>
                  </div>
                </div>
              </div>
              <div className="hidden flex-wrap gap-2 lg:flex">
                <span className="result-chip">{card.languageLabel}</span>
                <span className="result-chip">#{card.collectorNumber}</span>
                <span className="result-chip">{card.rarity}</span>
              </div>
            </aside>

            <div className="min-w-0">
              <div className="hidden lg:block">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-yellow-200">
                  {displaySetName} / {card.languageLabel}
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
                    Indexed
                  </span>
                </div>
                <CardDetailFacts
                  summaryLine={mobileSummary}
                  primaryFacts={primaryFacts}
                  secondaryFacts={secondaryFacts}
                />
              </div>

              <div className="mt-4 hidden border-t border-white/10 pt-4 lg:block">
                <CardDataConfidence card={card} />
              </div>
            </div>

            <aside className="flex min-w-0 flex-col gap-3 lg:col-start-2 xl:col-start-3 xl:row-start-1">
              <div className="rounded-2xl border border-blue-300/30 bg-[linear-gradient(145deg,rgba(37,99,235,0.2),rgba(8,18,37,0.65))] p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-200">
                      Raw market value
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">Live blended estimate</p>
                  </div>
                  <a
                    href="#market-intelligence"
                    className="rounded-full border border-blue-300/25 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-blue-100 transition hover:border-blue-200/60 hover:text-white"
                  >
                    Analytics
                  </a>
                </div>
                <div className="mt-4 border-t border-blue-200/15 pt-4">
                  <CardMarketPrice
                    key={card.slug}
                    card={card}
                    prefetchEnriched
                    className="block max-w-full break-words text-4xl font-semibold leading-none text-blue-100 sm:text-5xl"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-yellow-200/20 bg-slate-950/35 p-4 sm:p-5">
                <AddToPortfolioButton card={card} embedded />
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
          <GradedMarketPanel key={card.slug} card={card} liveMarketPrefetched />
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
