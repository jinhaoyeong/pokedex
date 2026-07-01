"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Smooth editorial page transition: the incoming route fades and lifts in.
 * Opacity/transform live on a wrapper that settles to no-transform, so fixed
 * modals are never trapped once the animation completes.
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
    void el.offsetWidth;
    el.classList.add("route-anim");
  }, [pathname]);

  return (
    <div ref={ref} className="route-transition route-anim">
      {children}
    </div>
  );
}
