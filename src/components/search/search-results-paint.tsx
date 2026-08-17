"use client";

import { useLayoutEffect, type ReactNode } from "react";

import { getAppScrollRoot, isMobileAppShell, scrollAppToTop } from "@/lib/app-scroll";

function currentScrollMetrics() {
  const scrollRoot = getAppScrollRoot();
  const useShell = Boolean(isMobileAppShell() && scrollRoot);

  if (useShell && scrollRoot) {
    return {
      y: scrollRoot.scrollTop,
      max: Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight),
    };
  }

  const doc = document.documentElement;
  return {
    y: window.scrollY,
    max: Math.max(0, doc.scrollHeight - window.innerHeight),
  };
}

/**
 * Pin Dex/search back to the top when a result payload replaces the skeleton
 * and overflow-anchor has already jumped the viewport down to empty rows.
 */
export function SearchResultsPaint({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const { y, max } = currentScrollMetrics();

    if (y < 160) {
      return;
    }

    if (max > 800 && y > max * 0.28) {
      scrollAppToTop();
    }
  }, []);

  return <div className="search-results-paint">{children}</div>;
}
