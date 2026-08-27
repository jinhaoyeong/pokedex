"use client";

import {
  deriveIdentityStatus,
  derivePriceStatus,
  statusClassName,
  statusLabel,
} from "@/lib/card-confidence";
import { useManagedCardGradingMarket } from "@/components/card/card-grading-market-context";
import type { TcgCard } from "@/types/pokemon";

export function CardDataConfidence({
  card,
  lastEnrichedAt,
  disputed = false,
  compact = false,
}: {
  card: TcgCard;
  lastEnrichedAt?: string | null;
  disputed?: boolean;
  compact?: boolean;
}) {
  const sharedMarket = useManagedCardGradingMarket();
  const displayCard = sharedMarket?.enrichedCard ?? card;
  const identityStatus = deriveIdentityStatus(displayCard);
  const priceStatus = derivePriceStatus(displayCard, lastEnrichedAt, disputed);
  const learningSource = displayCard.sources.find((source) => source.source === "Community learning cache");
  const pillClass = compact
    ? "rounded-full border px-2 py-0.5 text-[10px] font-semibold"
    : "rounded-full border px-3 py-1 text-xs font-semibold";

  return (
    <div className={`flex flex-wrap ${compact ? "justify-start gap-1.5 sm:justify-end" : "gap-2"}`}>
      <span className={`${pillClass} ${statusClassName(identityStatus)}`}>
        Identity: {statusLabel(identityStatus)}
      </span>
      <span className={`${pillClass} ${statusClassName(priceStatus)}`}>
        Price: {statusLabel(priceStatus)}
      </span>
      {learningSource ? (
        <span className={`${pillClass} border-violet-400/30 bg-violet-400/10 text-violet-100`}>
          Database learning active
        </span>
      ) : null}
    </div>
  );
}
