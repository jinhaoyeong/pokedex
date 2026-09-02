"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";

import { listCardImageDisplaySrc } from "@/lib/list-card-image";
import { HERO_FAN_SIZE, TODAYS_PICKS_LIMIT } from "@/lib/preview-constants";
import { selectTodaysPicks, shuffleMarqueeCards } from "@/lib/todays-picks";
import type { TcgCard } from "@/types/pokemon";

type HomeLivePreviewPayload = {
  pool?: TcgCard[];
  hero?: TcgCard[];
  picks?: TcgCard[];
  source?: "live" | "static";
};

export type HomeLiveCards = {
  hero: TcgCard[] | null;
  marquee: TcgCard[] | null;
  picks: TcgCard[] | null;
};

const EMPTY: HomeLiveCards = { hero: null, marquee: null, picks: null };

const Ctx = createContext<HomeLiveCards>(EMPTY);

let livePreviewPromise: Promise<HomeLivePreviewPayload | null> | null = null;

function loadLivePreview() {
  if (!livePreviewPromise) {
    livePreviewPromise = fetch("/api/todays-picks")
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return (await response.json()) as HomeLivePreviewPayload;
      })
      .catch(() => null)
      .then((payload) => {
        if (!payload) {
          livePreviewPromise = null;
        }

        return payload;
      });
  }

  return livePreviewPromise;
}

function preloadImages(urls: string[], timeoutMs = 400) {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          const done = () => resolve();
          const timer = window.setTimeout(done, timeoutMs);
          image.onload = () => {
            window.clearTimeout(timer);
            done();
          };
          image.onerror = () => {
            window.clearTimeout(timer);
            done();
          };
          image.src = url;
        }),
    ),
  ).then(() => undefined);
}

function deriveFromPool(payload: HomeLivePreviewPayload) {
  const pool = payload.pool ?? [];

  return {
    pool,
    hero: (payload.hero?.length ? payload.hero : pool).slice(0, HERO_FAN_SIZE),
    picks: (payload.picks?.length ? payload.picks : selectTodaysPicks(pool, TODAYS_PICKS_LIMIT)).slice(
      0,
      TODAYS_PICKS_LIMIT,
    ),
  };
}

/**
 * One live chase-catalog fetch for the homepage fan, ring, and today's picks.
 * First paint stays on bundled art; live images swap after a short preload.
 */
export function HomeLivePreviewProvider({ children }: { children: ReactNode }) {
  const [cards, setCards] = useState<HomeLiveCards>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    let idleId = 0;
    let idleTimer = 0;

    void loadLivePreview().then(async (payload) => {
      if (cancelled || payload?.source !== "live" || !payload.pool?.length) {
        return;
      }

      const derived = deriveFromPool(payload);

      // Picks are three small list tiles — swap them immediately so the 7-day
      // labels do not wait on hero art. Hero waits a short preload so the fan
      // never flashes empty. Marquee waits for idle so 3D copies stay lazy.
      setCards({
        hero: null,
        picks: derived.picks,
        marquee: null,
      });

      await preloadImages(derived.hero.map((card) => listCardImageDisplaySrc(card.image)));
      if (cancelled) {
        return;
      }

      setCards((current) => ({
        ...current,
        hero: derived.hero,
        picks: derived.picks,
      }));

      const applyMarquee = () => {
        if (!cancelled) {
          setCards((current) => ({
            ...current,
            marquee: shuffleMarqueeCards(derived.pool),
          }));
        }
      };

      if (typeof requestIdleCallback === "function") {
        idleId = requestIdleCallback(applyMarquee, { timeout: 1500 });
      } else {
        idleTimer = window.setTimeout(applyMarquee, 400);
      }
    });

    return () => {
      cancelled = true;
      if (idleId && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
      if (idleTimer) {
        window.clearTimeout(idleTimer);
      }
    };
  }, []);

  return createElement(Ctx.Provider, { value: cards }, children);
}

export function useHomeLiveCards(): HomeLiveCards {
  return useContext(Ctx);
}
