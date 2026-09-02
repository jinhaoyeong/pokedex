import type { MarketSourceStatus } from "@/types/pokemon";

/**
 * First-paint (`mode=core`) skips Magery and may abort a slow HTML scrape.
 * Those skips are not a finished miss — they must not paint TIMED OUT / API BLOCKED
 * over set-guide slabs that already arrived.
 */
export function firstPaintDeferredSourceState(options: {
  skipSoldComps: boolean;
  hasSignal?: boolean;
  timedOut?: boolean;
  blocked?: boolean;
}): MarketSourceStatus["state"] {
  if (options.hasSignal) {
    return "ready";
  }

  if (options.skipSoldComps) {
    return "partial";
  }

  if (options.blocked) {
    return "circuit_open";
  }

  if (options.timedOut) {
    return "timeout";
  }

  return "no_match";
}
