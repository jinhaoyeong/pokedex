"use client";

import { useEffect, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import type { PriceConsensus, TcgCard } from "@/types/pokemon";

export function CardMarketPrice({
  card,
  className,
  prefetchEnriched = false,
}: {
  card: TcgCard;
  className?: string;
  prefetchEnriched?: boolean;
}) {
  const [amountUsd, setAmountUsd] = useState(() => getHeadlineMarketPriceUsd(card));
  const [consensus, setConsensus] = useState<PriceConsensus | undefined>(card.priceConsensus);

  useEffect(() => {
    const headline = getHeadlineMarketPriceUsd(card);

    if (prefetchEnriched && headline > card.marketPriceUsd * 1.15) {
      return;
    }

    const controller = new AbortController();
    const lookupSetName = card.setEnglishName?.trim() || card.setName;
    const lookupCardName =
      card.language !== "en" && card.englishName?.trim()
        ? card.englishName.trim()
        : card.name;
    const params = new URLSearchParams({
      setName: lookupSetName,
      cardName: lookupCardName,
      cardNumber: card.collectorNumber,
      rawMarketPriceUsd: String(card.marketPriceUsd),
      mode: "core",
    });
    const setTotal = card.setPrintedTotal ?? card.setTotal;

    if (typeof setTotal === "number" && setTotal > 0) {
      params.set("setTotal", String(setTotal));
    }
    if (card.rarity && card.rarity !== "Unknown") {
      params.set("rarity", card.rarity);
    }
    if (card.setCode) {
      params.set("setCode", card.setCode);
    }
    if (card.language) {
      params.set("language", card.language);
    }
    if (card.englishName?.trim()) {
      params.set("englishCardName", card.englishName.trim());
    }

    fetch(`/api/grading-market?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (!data || controller.signal.aborted) {
          return;
        }

        const mergedCard: TcgCard = {
          ...card,
          marketPriceUsd: data.priceConsensus?.finalEstimateUsd ?? card.marketPriceUsd,
          gradedPrices: data.gradedPrices?.length ? data.gradedPrices : card.gradedPrices,
          priceConsensus: data.priceConsensus ?? card.priceConsensus,
        };

        setAmountUsd(getHeadlineMarketPriceUsd(mergedCard));
        setConsensus(mergedCard.priceConsensus);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [card, prefetchEnriched]);

  return (
    <>
      {consensus ? (
        <p className="mt-1 hidden text-xs leading-5 text-blue-100/80 sm:block">
          {consensus.sourceCount} sources / {Math.round(consensus.confidenceScore * 100)}%
        </p>
      ) : null}
      <ClientPrice amountUsd={amountUsd} className={className} />
    </>
  );
}
