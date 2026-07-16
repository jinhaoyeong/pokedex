"use client";

import { useEffect, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { useManagedCardGradingMarket } from "@/components/card/card-grading-market-context";
import { buildGradingMarketParams } from "@/lib/grading-market-params";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import type { PriceConsensus, TcgCard } from "@/types/pokemon";

export function CardMarketPrice({
  card,
  className,
  prefetchEnriched = false,
  managedMarket,
}: {
  card: TcgCard;
  className?: string;
  prefetchEnriched?: boolean;
  managedMarket?: {
    amountUsd: number;
    consensus?: PriceConsensus;
  };
}) {
  const sharedMarket = useManagedCardGradingMarket();
  const usesManagedMarket = Boolean(managedMarket || sharedMarket || prefetchEnriched);
  const [amountUsd, setAmountUsd] = useState(() => getHeadlineMarketPriceUsd(card));
  const [consensus, setConsensus] = useState<PriceConsensus | undefined>(card.priceConsensus);

  const resolvedAmountUsd =
    managedMarket?.amountUsd ??
    sharedMarket?.headlinePriceUsd ??
    amountUsd;
  const resolvedConsensus =
    managedMarket?.consensus ?? sharedMarket?.priceConsensus ?? consensus;
  const isResolvingMarket = Boolean(
    prefetchEnriched &&
      (sharedMarket?.isLoadingCore ||
        (sharedMarket?.isLoadingFull &&
          !(Number.isFinite(sharedMarket.headlinePriceUsd) && sharedMarket.headlinePriceUsd > 0))),
  );
  const hasResolvedPrice = Number.isFinite(resolvedAmountUsd) && resolvedAmountUsd > 0;

  useEffect(() => {
    if (usesManagedMarket) {
      return;
    }

    const controller = new AbortController();

    fetch(`/api/grading-market?${buildGradingMarketParams(card, "core").toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data || controller.signal.aborted) {
          return;
        }

        const mergedCard: TcgCard = {
          ...card,
          marketPriceUsd: card.marketPriceUsd,
          gradedPrices: data.gradedPrices?.length ? data.gradedPrices : card.gradedPrices,
          priceConsensus: data.priceConsensus ?? card.priceConsensus,
        };

        setAmountUsd(getHeadlineMarketPriceUsd(mergedCard));
        setConsensus(mergedCard.priceConsensus);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [card, usesManagedMarket]);

  return (
    <>
      {isResolvingMarket ? (
        <span
          className={`market-price-skeleton block h-[1em] max-w-full animate-pulse rounded-md bg-white/10 ${className ?? ""}`}
          aria-label="Loading market price"
        />
      ) : resolvedConsensus && hasResolvedPrice ? (
        <p className="mt-1 text-xs leading-5 text-[var(--text-faint)]">
          {resolvedConsensus.sourceCount} sources / {Math.round(resolvedConsensus.confidenceScore * 100)}%
        </p>
      ) : null}
      {isResolvingMarket ? null : hasResolvedPrice ? (
        <ClientPrice amountUsd={resolvedAmountUsd} className={className} />
      ) : (
        <span className={`market-price-pending block ${className ?? ""}`}>Market Pending</span>
      )}
    </>
  );
}
