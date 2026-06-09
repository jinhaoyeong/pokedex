"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import { readSettings } from "@/lib/settings-store";

export function SearchDefaultsApplier() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasApplied = useRef(false);

  useEffect(() => {
    if (pathname !== "/search" || hasApplied.current) {
      return;
    }

    const settings = readSettings();
    const nextParams = new URLSearchParams(searchParams.toString());
    let changed = false;

    if (!searchParams.has("lang") && settings.defaultSearchLanguage !== "all") {
      nextParams.set("lang", settings.defaultSearchLanguage);
      changed = true;
    }

    if (
      !searchParams.has("sort") &&
      settings.defaultSearchSort !== DEFAULT_SEARCH_SORT
    ) {
      nextParams.set("sort", settings.defaultSearchSort);
      changed = true;
    }

    if (!changed) {
      return;
    }

    hasApplied.current = true;
    const queryString = nextParams.toString();
    router.replace(queryString ? `/search?${queryString}` : "/search");
  }, [pathname, router, searchParams]);

  return null;
}
