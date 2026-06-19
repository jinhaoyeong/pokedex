"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Plays a quick "screen power-on" flicker whenever the route changes. Uses
 * opacity/filter on a wrapper that resets to no-transform, so it never traps
 * fixed-position modals once the animation settles.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const scan = useRef<HTMLDivElement>(null);

  useEffect(() => {
    for (const el of [ref.current, scan.current]) {
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
      <div ref={scan} className="route-powerline route-anim" aria-hidden="true" />
      <div ref={ref} className="route-transition route-anim">
        {children}
      </div>
    </div>
  );
}
