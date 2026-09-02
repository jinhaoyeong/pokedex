"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Smooth editorial page transition: the incoming route fades and lifts in.
 * Remounting on pathname replays the CSS animation without a layout-forcing
 * reflow. Opacity/transform live on a wrapper that settles to no-transform,
 * so fixed modals are never trapped once the animation completes.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="route-transition route-anim">
      {children}
    </div>
  );
}
