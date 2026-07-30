"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Replays the route-entry animation whenever the pathname changes. */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.classList.remove("route-anim");
    void element.offsetWidth;
    element.classList.add("route-anim");
  }, [pathname]);

  return (
    <div ref={ref} className="route-transition route-anim">
      {children}
    </div>
  );
}
