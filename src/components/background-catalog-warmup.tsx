"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { runBackgroundCatalogWarmup } from "@/lib/background-catalog-warmup";

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
      void runBackgroundCatalogWarmup({
        signal: controller.signal,
        prefetchRoute: (href) => {
          router.prefetch(href);
        },
      }).catch(() => {
        // Warmup is best-effort.
      });
    };

    if (document.documentElement.classList.contains("app-ready")) {
      startWarmup();
    } else {
      window.addEventListener("pokedex-boot-complete", startWarmup, { once: true });
    }

    return () => {
      controller.abort();
      window.removeEventListener("pokedex-boot-complete", startWarmup);
    };
  }, [router]);

  return null;
}
