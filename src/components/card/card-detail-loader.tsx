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
import { shouldKeepCurrentCatalogCard } from "@/lib/card-detail-catalog-merge";
import { sanitizePartialPreviewMarketCard } from "@/lib/grading-market-lookup";
import type { TcgCard } from "@/types/pokemon";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; card: TcgCard }
  | { status: "unavailable" }
  | { status: "not_found" };

function resolveInitialState({
  initialCard,
  lookupFailed,
  initialNotFound,
}: {
  initialCard: TcgCard | null;
  lookupFailed: boolean;
  initialNotFound: boolean;
}): LoadState {
  if (initialCard) {
    return { status: "ready", card: sanitizePartialPreviewMarketCard(initialCard) };
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
    resolveInitialState({ initialCard, lookupFailed, initialNotFound }),
  );

  useEffect(() => {
    if (initialNotFound) {
      return;
    }

    const controller = new AbortController();

    // Browser caches are intentionally read after hydration. Reading them in
    // the useState initializer makes the client render a card while the server
    // rendered the skeleton, producing a hydration mismatch.
    const clientCard =
      getStashedCardForNavigation(slug) ?? getCachedClientCard(slug);
    if (clientCard) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", card: clientCard });
        }
      });
    }

    if (initialCard) {
      warmClientCardCache(slug, sanitizePartialPreviewMarketCard(initialCard));
    }

    // Prefer HTTP cache for catalog identity (API sets max-age). Market panels
    // still refresh independently via /api/price and /api/grading-market.
    fetch(`/api/cards/${encodeURIComponent(slug)}`, {
      cache: "default",
      signal: controller.signal,
    })
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

        const sanitizedCard = sanitizePartialPreviewMarketCard(payload.card);
        warmClientCardCache(slug, sanitizedCard);

        return { status: "ready" as const, card: sanitizedCard };
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
            if (shouldKeepCurrentCatalogCard(current.card, next.card)) {
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
      <main className="app-main app-frame flex min-h-screen w-full flex-col gap-6">
        <h1 className="text-2xl font-bold text-white">Card not found</h1>
        <p className="text-slate-400">No catalog record matched this card link.</p>
      </main>
    );
  }

  return <CardDetailView card={state.card} />;
}
