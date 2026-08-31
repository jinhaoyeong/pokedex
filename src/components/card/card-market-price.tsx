"use client";

import { useEffect, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { useManagedCardGradingMarket } from "@/components/card/card-grading-market-context";
import { buildGradingMarketParams } from "@/lib/grading-market-params";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { shouldShowNmSecondary } from "@/lib/price/priced-payload";
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
    (Number.isFinite(sharedMarket?.headlinePriceUsd) && (sharedMarket?.headlinePriceUsd ?? 0) > 0
      ? sharedMarket!.headlinePriceUsd
      : null) ??
    amountUsd;
  const resolvedConsensus =
    managedMarket?.consensus ?? sharedMarket?.priceConsensus ?? consensus;
  const hasResolvedPrice = Number.isFinite(resolvedAmountUsd) && resolvedAmountUsd > 0;
  const isResolvingMarket = Boolean(
    prefetchEnriched &&
      !hasResolvedPrice &&
      (sharedMarket?.isLoadingCore || sharedMarket?.isLoadingFull),
  );

  useEffect(() => {
    if (usesManagedMarket) {
      return;
    }

    const controller = new AbortController();

    fetch(`/api/grading-market?${buildGradingMarketParams(card).toString()}`, {
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
          className={`market-price-skeleton block h-[1.15em] max-w-[12rem] animate-pulse rounded-md bg-white/10 ${className ?? ""}`}
          aria-label="Loading market price"
        />
      ) : hasResolvedPrice ? (
        <>
          <ClientPrice amountUsd={resolvedAmountUsd} className={className} />
          {resolvedConsensus ? (
            <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-faint)]">
              {resolvedConsensus.sourceCount} sources / {Math.round(resolvedConsensus.confidenceScore * 100)}%
            </p>
          ) : null}
          {shouldShowNmSecondary(resolvedAmountUsd, card.nmMarketUsd) ? (
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              TCGPlayer NM <ClientPrice amountUsd={card.nmMarketUsd!} className="text-slate-300" />
            </p>
          ) : null}
        </>
      ) : (
        <span className="market-price-pending block">Market Pending</span>
      )}
    </>
  );
}
