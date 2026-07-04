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
}: {
  card: TcgCard;
  lastEnrichedAt?: string | null;
  disputed?: boolean;
}) {
  const sharedMarket = useManagedCardGradingMarket();
  const displayCard = sharedMarket?.enrichedCard ?? card;
  const identityStatus = deriveIdentityStatus(displayCard);
  const priceStatus = derivePriceStatus(displayCard, lastEnrichedAt, disputed);
  const learningSource = displayCard.sources.find((source) => source.source === "Community learning cache");

  return (
    <div className="flex flex-wrap gap-2">
      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName(identityStatus)}`}>
        Identity: {statusLabel(identityStatus)}
      </span>
      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName(priceStatus)}`}>
        Price: {statusLabel(priceStatus)}
      </span>
      {learningSource ? (
        <span className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1 text-xs font-semibold text-violet-100">
          Database learning active
        </span>
      ) : null}
    </div>
  );
}
