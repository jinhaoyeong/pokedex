"use client";

import type { ReactNode } from "react";

import { clamp01, useScrollDrivenTransform } from "@/hooks/use-scroll-progress";

/**
 * Wraps the hero (headline + buttons + 5-card fan) and makes it "recede" as the
 * page scrolls: it scales down slightly, drifts upward and softens, so the
 * marquee below reads as coming forward. Driven imperatively off window scroll
 * (see useScrollDrivenTransform) — no per-frame React renders, GPU transforms
 * only.
 */
export function HeroScene({ children }: { children: ReactNode }) {
  const ref = useScrollDrivenTransform<HTMLDivElement>((el, { scrollY, viewportH }) => {
    // Complete the recede over the first ~75% of a viewport of scrolling.
    const p = clamp01(scrollY / (viewportH * 0.75));
    const y = -p * viewportH * 0.1; // 0 → -10vh
    const scale = 1 - p * 0.12; // 1 → 0.88
    const opacity = 1 - p * 0.5; // 1 → 0.5
    el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    el.style.opacity = opacity.toFixed(3);
  });

  return (
    <div ref={ref} className="hero-scene">
      {children}
    </div>
  );
}
