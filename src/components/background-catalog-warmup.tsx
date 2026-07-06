"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function BackgroundCatalogWarmup() {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    const controller = new AbortController();

    const startWarmup = () => {
      const run = () => {
        void import("@/lib/background-catalog-warmup")
          .then(({ runBackgroundCatalogWarmup }) =>
            runBackgroundCatalogWarmup({
              signal: controller.signal,
              prefetchRoute: (href) => {
                router.prefetch(href);
              },
            }),
          )
          .catch(() => {
            // Warmup is best-effort.
          });
      };

      if ("requestIdleCallback" in window) {
        const idleId = window.requestIdleCallback(run, { timeout: 3000 });
        return () => window.cancelIdleCallback(idleId);
      }

      const timeoutId = globalThis.setTimeout(run, 1200);
      return () => globalThis.clearTimeout(timeoutId);
    };

    let cancelWarmup: (() => void) | undefined;
    const handleBootComplete = () => {
      cancelWarmup = startWarmup();
    };

    if (document.documentElement.classList.contains("app-ready")) {
      cancelWarmup = startWarmup();
    } else {
      window.addEventListener("pokedex-boot-complete", handleBootComplete, { once: true });
    }

    return () => {
      controller.abort();
      cancelWarmup?.();
      window.removeEventListener("pokedex-boot-complete", handleBootComplete);
    };
  }, [router]);

  return null;
}
