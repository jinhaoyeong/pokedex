"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

import { readSettings } from "@/lib/settings-store";

export function RouteScrollManager() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const previousRestoration = useRef<ScrollRestoration | null>(null);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) {
      return;
    }

    previousRestoration.current = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      if (previousRestoration.current) {
        window.history.scrollRestoration = previousRestoration.current;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || window.location.hash) {
      return;
    }

    if (!readSettings().scrollToTopOnNavigate) {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, search]);

  return null;
}
