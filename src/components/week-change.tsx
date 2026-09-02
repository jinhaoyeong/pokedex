"use client";

import { formatWeekChangePercent, cardWeekChange } from "@/lib/trending";
import type { TcgCard } from "@/types/pokemon";

export function WeekChange({ card }: { card: TcgCard }) {
  const change = cardWeekChange(card);
  const label = formatWeekChangePercent(change);

  if (!label || !change) {
    return null;
  }

  const direction = change.percent > 0 ? "up" : "down";

  return (
    <span className={`week-change week-change--${direction}`}>
      {label} 7d
    </span>
  );
}
