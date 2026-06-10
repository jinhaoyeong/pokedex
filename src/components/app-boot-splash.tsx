"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  hasBootSessionReady,
  markBootSessionReady,
  warmBootPreviewCards,
  warmClientSetsCache,
} from "@/lib/client-catalog-cache";
import type { TcgCard, TcgSet } from "@/types/pokemon";

const MIN_SPLASH_MS = 900;
const MAX_SPLASH_MS = 4500;

type BootstrapPayload = {
  sets?: TcgSet[];
  previewCards?: TcgCard[];
};

async function loadBootstrap(signal: AbortSignal) {
  const response = await fetch("/api/bootstrap", { signal });

  if (!response.ok) {
    throw new Error("Bootstrap request failed");
  }

  return (await response.json()) as BootstrapPayload;
}

export function AppBootSplash() {
  const router = useRouter();
  const [statusText, setStatusText] = useState("Warming up your card dex...");

  useEffect(() => {
    if (hasBootSessionReady()) {
      document.documentElement.classList.add("app-ready");
      return;
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    let finished = false;

    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      markBootSessionReady();

      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);

      window.setTimeout(() => {
        document.documentElement.classList.add("app-ready");
      }, remaining);
    };

    router.prefetch("/search");
    router.prefetch("/portfolio");
    router.prefetch("/settings");

    void Promise.allSettled([
      loadBootstrap(controller.signal).then((payload) => {
        if (payload.sets?.length) {
          warmClientSetsCache("all", payload.sets);
        }

        if (payload.previewCards?.length) {
          warmBootPreviewCards(payload.previewCards);
        }

        setStatusText("Card board synced");
      }),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, MAX_SPLASH_MS);
      }),
    ]).finally(finish);

    return () => {
      controller.abort();
    };
  }, [router]);

  return (
    <div className="app-boot-splash" role="status" aria-live="polite" aria-busy="true">
      <div className="app-boot-splash__backdrop" />
      <div className="app-boot-splash__panel">
        <div className="app-boot-splash__orb" aria-hidden="true">
          <span className="app-boot-splash__orb-core" />
          <span className="app-boot-splash__orb-ring app-boot-splash__orb-ring--one" />
          <span className="app-boot-splash__orb-ring app-boot-splash__orb-ring--two" />
        </div>
        <p className="app-boot-splash__brand pokemon-display-title">PokePokedex</p>
        <p className="app-boot-splash__status">{statusText}</p>
        <div className="app-boot-splash__progress" aria-hidden="true">
          <span className="app-boot-splash__progress-bar" />
        </div>
      </div>
    </div>
  );
}
