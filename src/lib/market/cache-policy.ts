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

function isTcgFishSource(source: string) {
  return /tcgfish/i.test(source);
}

function sourceIsReady(status: MarketSourceStatus) {
  return status.state === "ready" || status.state === "cached";
}

/** TCGFish timeout/skip must not mark the payload partial when PC pop + sold comps are ready. */
export function hasBlockingGradingMarketIncomplete(
  statuses: MarketSourceStatus[] | null | undefined,
) {
  if (!statuses?.length) {
    return false;
  }

  const pcPopReady = statuses.some(
    (status) => /pricecharting public population/i.test(status.source) && sourceIsReady(status),
  );
  const soldReady = statuses.some(
    (status) => /sold-listing/i.test(status.source) && sourceIsReady(status),
  );
  const coreReady = pcPopReady && soldReady;

  return statuses.some((status) => {
    if (sourceIsReady(status)) {
      return false;
    }
    if (coreReady && isTcgFishSource(status.source)) {
      return false;
    }
    return true;
  });
}

