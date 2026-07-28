"use client";

import { useEffect } from "react";

import { shouldLimitContinuousMotion } from "@/hooks/use-scroll-progress";

/**
 * Continuous scroll-linked drift for the workspace index's oversized ghost
 * numerals: each numeral eases vertically against the scroll (a quiet
 * parallax), so the section feels conducted by the scroll the same way the
 * ring marquee does — not just revealed once and inert.
 *
 * Renders nothing. One passive scroll listener, rAF-throttled, imperative
 * GPU-only transform writes on three elements — no React re-renders, no
 * layout properties touched. Skipped entirely under prefers-reduced-motion.
 */
export function WorkspaceMotion() {
  useEffect(() => {
    if (shouldLimitContinuousMotion()) {
      return;
    }

    const numerals = Array.from(
      document.querySelectorAll<HTMLElement>(".feature-row-no"),
    );
    if (!numerals.length) {
      return;
    }

    let ticking = false;
    const update = () => {
      ticking = false;
      const vh = window.innerHeight || 1;
      for (const el of numerals) {
        const rect = el.getBoundingClientRect();
        // -0.5 at the viewport bottom → +0.5 at the top; the numeral drifts
        // ~36px against the scroll across that travel. Clamped so off-screen
        // numerals can't accumulate a drift larger than the row's padding and
        // collide with the hairline divider above them.
        const p = Math.min(0.5, Math.max(-0.5, 0.5 - (rect.top + rect.height / 2) / vh));
        el.style.transform = `translate3d(0, ${(p * 36).toFixed(1)}px, 0)`;
      }
    };
    const onScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return null;
}
