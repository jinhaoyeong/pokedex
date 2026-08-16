"use client";

import { finishShortLabel, shouldShowFinishSwitcher } from "@/lib/card-finish";
import type { CardFinishId, TcgCard } from "@/types/pokemon";

export function CardFinishSwitcher({
  card,
  selected,
  onSelect,
  liveCard,
}: {
  card: TcgCard;
  selected: CardFinishId;
  onSelect: (finish: CardFinishId) => void;
  liveCard?: TcgCard;
}) {
  const finishes = card.finishMarkets ?? [];

  if (!finishes.length) {
    return null;
  }

  if (!shouldShowFinishSwitcher(card)) {
    const identified = finishes.find((finish) => finish.id === selected) ?? finishes[0];

    return (
      <div className="mt-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
          Print finish
        </p>
        <p className="mt-1.5 text-sm font-semibold text-slate-200">
          {identified.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Identified automatically. This print is not sold as non-holo or reverse holo.
        </p>
      </div>
    );
  }

  const selectedLive = liveCard?.finish === selected ? liveCard : null;
  const lastSold = selectedLive?.recentSales?.[0];
  const popTotal = selectedLive?.psaPopulation?.totalCertified;

  return (
    <div className="mt-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
        Print finish
      </p>
      <div className="segment-control mt-1.5 flex-wrap gap-1.5">
        {finishes.map((finish) => {
          const isActive = finish.id === selected;

          return (
            <button
              key={finish.id}
              type="button"
              onClick={() => onSelect(finish.id)}
              className={`segment-btn ${isActive ? "segment-btn--active" : ""}`}
              aria-pressed={isActive}
            >
              {finishShortLabel(finish.id)}
              {finish.ungradedUsd > 0 ? (
                <span className="ml-1 text-[10px] font-semibold opacity-80">
                  ${finish.ungradedUsd.toFixed(finish.ungradedUsd >= 100 ? 0 : 2)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-slate-400">
        {popTotal || lastSold
          ? [
              popTotal ? `Pop ${popTotal.toLocaleString()}` : null,
              lastSold
                ? `Last sold $${lastSold.price.toFixed(lastSold.price >= 100 ? 0 : 2)} (${lastSold.date})`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : "Price, population, and last sold stay on the selected finish instead of mixing holo and reverse markets."}
      </p>
    </div>
  );
}
