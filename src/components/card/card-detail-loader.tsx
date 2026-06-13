"use client";

import { useEffect, useState } from "react";

import { CardDetailSkeleton } from "@/components/card/card-detail-skeleton";
import { CardDetailUnavailable } from "@/components/card/card-detail-unavailable";
import { CardDetailView } from "@/components/card/card-detail-view";
import {
  getCachedClientCard,
  getStashedCardForNavigation,
  warmClientCardCache,
} from "@/lib/client-catalog-cache";
import type { TcgCard } from "@/types/pokemon";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; card: TcgCard }
  | { status: "unavailable" }
  | { status: "not_found" };

function resolveInitialState({
  slug,
  initialCard,
  lookupFailed,
  initialNotFound,
}: {
  slug: string;
  initialCard: TcgCard | null;
  lookupFailed: boolean;
  initialNotFound: boolean;
}): LoadState {
  const stashed = getStashedCardForNavigation(slug);

  if (stashed) {
    return { status: "ready", card: stashed };
  }

  const cached = getCachedClientCard(slug);

  if (cached) {
    return { status: "ready", card: cached };
  }

  if (initialCard) {
    return { status: "ready", card: initialCard };
  }

  if (initialNotFound) {
    return { status: "not_found" };
  }

  if (lookupFailed) {
    return { status: "loading" };
  }

  return { status: "loading" };
}

export function CardDetailLoader({
  slug,
  initialCard = null,
  lookupFailed = false,
  initialNotFound = false,
}: {
  slug: string;
  initialCard?: TcgCard | null;
  lookupFailed?: boolean;
  initialNotFound?: boolean;
}) {
  const [state, setState] = useState<LoadState>(() =>
    resolveInitialState({ slug, initialCard, lookupFailed, initialNotFound }),
  );

  useEffect(() => {
    if (initialNotFound) {
      return;
    }

    if (initialCard) {
      warmClientCardCache(slug, initialCard);
    }

    const controller = new AbortController();

    fetch(`/api/cards/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          return { status: "not_found" as const };
        }

        if (!response.ok) {
          return { status: "unavailable" as const };
        }

        const payload = (await response.json()) as { card?: TcgCard };
        if (!payload.card) {
          return { status: "not_found" as const };
        }

        warmClientCardCache(slug, payload.card);

        if (payload.card.sources.some((source) => source.source === "Community learning cache")) {
          void fetch("/api/card-cache/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug }),
          }).catch(() => undefined);
        }

        return { status: "ready" as const, card: payload.card };
      })
      .then((next) => {
        if (controller.signal.aborted) {
          return;
        }

        setState((current) => {
          if (next.status === "not_found") {
            return current.status === "ready" ? current : next;
          }

          if (next.status === "unavailable") {
            return current.status === "ready" ? current : next;
          }

          if (current.status === "ready" && next.status === "ready") {
            const currentPrice = current.card.marketPriceUsd;
            const nextPrice = next.card.marketPriceUsd;

            if (currentPrice > 0 && !(nextPrice > 0)) {
              return current;
            }

            if (
              (current.card.attacks?.length ?? 0) > 0 &&
              (next.card.attacks?.length ?? 0) === 0 &&
              current.card.rarity !== "Localized release" &&
              next.card.rarity === "Localized release"
            ) {
              return current;
            }
          }

          return next;
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        if (!controller.signal.aborted) {
          setState((current) =>
            current.status === "ready" ? current : { status: "unavailable" },
          );
        }
      });

    return () => {
      controller.abort();
    };
  }, [slug, initialCard, initialNotFound, lookupFailed]);

  if (state.status === "loading") {
    return <CardDetailSkeleton />;
  }

  if (state.status === "unavailable") {
    return <CardDetailUnavailable />;
  }

  if (state.status === "not_found") {
    return (
      <main className="app-main mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-3 py-8 sm:px-10">
        <h1 className="text-2xl font-bold text-white">Card not found</h1>
        <p className="text-slate-400">No catalog record matched this card link.</p>
      </main>
    );
  }

  return <CardDetailView card={state.card} />;
}
