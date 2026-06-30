"use client";

import { useEffect, useState } from "react";

import { cardNeedsGradingMarketEnrichment } from "@/lib/grading-market-lookup";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import type { TcgCard } from "@/types/pokemon";

type PriceLookupPayload = {
  ungradedUsd?: number;
  primaryProvider?: string;
};

// Providers whose price is a real guide/sold figure (not a catalog feed) and may
// therefore replace the server-side display estimate on a list row.
const VERIFIED_PROVIDERS = new Set(["pricecharting-api", "ebay"]);

// Bounded client-side queue so a 50-card page resolves prices in render order
// (top/visible cards first). Prices come from /api/price — cache-first and
// non-blocking — so the list never triggers a PriceCharting scrape burst.
const MAX_CONCURRENT = 4;
let activeCount = 0;
const pending: Array<() => void> = [];

function pump() {
  while (activeCount < MAX_CONCURRENT && pending.length) {
    const task = pending.shift();
    task?.();
  }
}

function runQueued(task: () => Promise<void>) {
  const start = () => {
    activeCount += 1;
    void task().finally(() => {
      activeCount -= 1;
      pump();
    });
  };
  pending.push(start);
  pump();
}

function isLowConfidenceLocalizedEstimate(card: TcgCard) {
  if (card.language === "en") {
    return false;
  }

  const hasVerifiedMarketSource =
    card.priceConsensus?.sources?.some((source) => {
      const score = source.confidenceScore ?? 0;

      return (
        source.evidenceType === "sold_comp" ||
        (source.evidenceType === "guide_snapshot" && score >= 0.5) ||
        /pricecharting|public guide|public sold|magery|grading market consensus/i.test(
          source.source ?? "",
        )
      );
    }) ||
    card.sources?.some((source) =>
      /pricecharting|public guide|public sold|magery|grading market consensus/i.test(
        source.source,
      ),
    ) ||
    card.gradedPrices?.some(
      (price) =>
        price.grade === "Ungraded" &&
        price.value > 0 &&
        /pricecharting|public guide|public sold|magery|consensus/i.test(price.source ?? ""),
    );

  if (hasVerifiedMarketSource) {
    return false;
  }

  const estimateSourcePatterns = [
    /early market estimate/i,
    /localized market estimate/i,
    /rarity estimate/i,
    /localized search group estimate/i,
  ];
  const sourceLooksEstimated =
    card.sources?.some((source) =>
      estimateSourcePatterns.some((pattern) => pattern.test(source.source)),
    ) ||
    card.priceConsensus?.sources?.some((source) =>
      estimateSourcePatterns.some((pattern) => pattern.test(source.source)),
    ) ||
    card.gradedPrices?.some(
      (price) =>
        price.grade === "Ungraded" &&
        estimateSourcePatterns.some((pattern) => pattern.test(price.source ?? "")),
    );

  return Boolean(
    sourceLooksEstimated ||
      (card.priceConsensus?.confidence === "low" &&
        (card.priceConsensus.confidenceScore ?? 1) < 0.4),
  );
}

/**
 * Lazily upgrade a list/grid row's price from the block-resistant `/api/price`
 * pipeline (cache-first + non-blocking APIs — never a scrape). The row already
 * renders the server-side estimate instantly; we only REPLACE it when the
 * pipeline returns a verified guide/sold price (e.g. PriceCharting API / eBay),
 * so a catalog feed can never regress the displayed estimate.
 */
export function useLazyCardPrice(card: TcgCard): {
  priceUsd: number;
  isLoading: boolean;
  isEstimate: boolean;
} {
  const needsEnrichment = cardNeedsGradingMarketEnrichment(card);
  // Localized (non-English) rows always render a non-zero baseline immediately —
  // the server now seeds a display estimate, so we never blank them to "pending".
  // English rows keep their original behavior (seed 0 for low-confidence estimates
  // so they fall through to the "Price pending" copy until enrichment resolves).
  const [priceUsd, setPriceUsd] = useState(() =>
    card.language !== "en" || !isLowConfidenceLocalizedEstimate(card)
      ? getHeadlineMarketPriceUsd(card)
      : 0,
  );
  const [isEstimate, setIsEstimate] = useState(() => isLowConfidenceLocalizedEstimate(card));
  const [isLoading, setIsLoading] = useState(needsEnrichment);

  useEffect(() => {
    if (!needsEnrichment) {
      return;
    }

    const controller = new AbortController();

    runQueued(async () => {
      if (controller.signal.aborted) {
        return;
      }

      try {
        const params = new URLSearchParams();
        params.set("slug", card.slug);
        params.set("name", card.name);
        params.set("language", card.language);
        if (card.id) params.set("cardId", card.id);
        if (card.setCode) params.set("setCode", card.setCode);
        if (card.setName) params.set("setName", card.setName);
        if (card.setEnglishName) params.set("setEnglishName", card.setEnglishName);
        if (card.collectorNumber) params.set("number", card.collectorNumber);
        if (card.englishName) params.set("englishName", card.englishName);
        if (card.rarity) params.set("rarity", card.rarity);

        const response = await fetch(`/api/price?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok || controller.signal.aborted) {
          return;
        }

        const data = (await response.json()) as PriceLookupPayload;

        if (controller.signal.aborted) {
          return;
        }

        // Only let a VERIFIED guide/sold price replace the row's estimate; a
        // catalog feed (which can be a mismatched low) must never win.
        if (
          typeof data.ungradedUsd === "number" &&
          data.ungradedUsd > 0 &&
          data.primaryProvider &&
          VERIFIED_PROVIDERS.has(data.primaryProvider)
        ) {
          setPriceUsd(data.ungradedUsd);
          setIsEstimate(false);
        }
      } catch {
        // Best-effort; keep the server estimate on failure.
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    });

    return () => controller.abort();
  }, [card, needsEnrichment]);

  return { priceUsd, isLoading, isEstimate };
}
