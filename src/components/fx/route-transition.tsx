"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Friendly page transition: a quick Poké Ball "catch" flash sweeps over the
 * screen and the new page rises in. The wrapper animates opacity only (no
 * transform/filter) so it never traps fixed-position modals.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const page = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);

  useEffect(() => {
    for (const el of [page.current, flash.current]) {
      if (!el) {
        continue;
      }
      el.classList.remove("route-anim");
      // Force reflow so the animation restarts on every navigation.
      void el.offsetWidth;
      el.classList.add("route-anim");
    }
  }, [pathname]);

  return (
    <div className="route-transition-wrap">
      <div ref={flash} className="route-pokeflash route-anim" aria-hidden="true">
        <span className="route-pokeflash__ball" />
      </div>
      <div ref={page} className="route-transition route-anim">
        {children}
      </div>
    </div>
  );
}
