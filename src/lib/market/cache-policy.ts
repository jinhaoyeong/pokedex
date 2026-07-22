import type { MarketSourceStatus } from "@/types/pokemon";

const RETRYABLE_MARKET_STATES = new Set<MarketSourceStatus["state"]>([
  "timeout",
  "circuit_open",
  "provider_error",
  "failed",
]);

export function hasRetryableMarketSourceFailure(
  statuses: MarketSourceStatus[] | null | undefined,
) {
  return Boolean(statuses?.some((status) => RETRYABLE_MARKET_STATES.has(status.state)));
}

