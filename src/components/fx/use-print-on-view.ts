"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { getAppScrollRoot, isMobileAppShell } from "@/lib/app-scroll";

// Arming must happen before paint to avoid a flash of the settled state,
// but useLayoutEffect warns during SSR — so fall back on the server.
const useArmingEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** `undefined` while the server render / no-JS view shows the settled state. */
export type PrintPhase = "armed" | "run" | undefined;

/**
 * Arms the print-in choreography once the section reaches the viewport.
 *
 * Returns `undefined` until the client takes over, so the server render and
 * any no-JS view show the finished, fully visible state rather than blank
 * rows — the hidden state is only ever applied by JS. Reduced-motion never
 * arms at all, so those readers get the settled state and no observer.
 *
 * Lifted out of portfolio-client so the registry, the ledger and every
 * binder-insights sheet share one implementation and one set of thresholds;
 * a second copy would drift and the page would print in two rhythms.
 */
export function usePrintOnView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [phase, setPhase] = useState<"idle" | "armed" | "run">("idle");

  useArmingEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // Arming is what hides the section, so nothing arms unless the thing that
    // releases it exists. Without the observer the settled state simply stays.
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    setPhase("armed");
  }, []);

  useEffect(() => {
    if (phase !== "armed") {
      return;
    }

    const node = ref.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase("run");
          observer.disconnect();
        }
      },
      {
        root: isMobileAppShell() ? getAppScrollRoot() : null,
        // Any sliver of the section counts. A fractional threshold is measured
        // against the *target's* height, so a section taller than the viewport
        // can never reach it: the Dex results list runs several screens deep on
        // a phone, where min(height, viewport) / height sat under 0.06. The
        // observer stayed silent and every tile was left parked at opacity 0 by
        // [data-print="armed"] — a heading with nothing beneath it.
        threshold: 0,
        rootMargin: "0px 0px -4% 0px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [phase]);

  return { ref, phase: (phase === "idle" ? undefined : phase) as PrintPhase };
}
