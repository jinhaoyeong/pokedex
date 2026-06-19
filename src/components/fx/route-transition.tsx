"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Plays a quick crossfade whenever the route changes. Uses opacity only (no
 * transform) so it never interferes with fixed-position overlays/modals.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.classList.remove("route-anim");
    // Force reflow so the animation restarts on every navigation.
    void el.offsetWidth;
    el.classList.add("route-anim");
  }, [pathname]);

  return (
    <div ref={ref} className="route-transition route-anim">
      {children}
    </div>
  );
}
