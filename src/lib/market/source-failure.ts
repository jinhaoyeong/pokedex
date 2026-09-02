import type { MarketSourceStatus } from "@/types/pokemon";

export type MarketFailureKind = "ok" | "api_ban" | "timeout" | "code" | "no_match";

const READY_STATES = new Set(["ready", "cached", "fallback", "partial"]);
const NO_MATCH_STATES = new Set([
  "no_match",
  "identity_incomplete",
  "disabled",
  "missing_credentials",
]);

/** True when origin HTML is blocked/circuit-open and the reader proxy cannot recover it. */
export function isPublicHtmlTransportBlocked(input: {
  originDirectBlocked: boolean;
  originCircuitOpen: boolean;
  readerCircuitOpen: boolean;
}) {
  return (input.originDirectBlocked || input.originCircuitOpen) && input.readerCircuitOpen;
}

export function classifyMarketFailureFromText(text: string): Exclude<MarketFailureKind, "ok"> {
  const value = text.toLowerCase();

  if (
    /429|403|401|rate[- ]?limit|too many requests|blocked|forbidden|cloudflare|bot wall|cf-mitigated|circuit open|cooling down/.test(
      value,
    )
  ) {
    return "api_ban";
  }

  if (/timeout|timed out|budget exceeded|aborted/.test(value)) {
    return "timeout";
  }

  if (/no_match|identity_incomplete|did not expose|no matching|no usable/.test(value)) {
    return "no_match";
  }

  return "code";
}

export function classifyMarketSourceFailure(
  status: Pick<MarketSourceStatus, "state" | "warning" | "note">,
): MarketFailureKind {
  if (READY_STATES.has(status.state)) {
    return "ok";
  }

  if (status.state === "circuit_open") {
    return "api_ban";
  }

  if (status.state === "timeout") {
    return "timeout";
  }

  if (NO_MATCH_STATES.has(status.state)) {
    return "no_match";
  }

  return classifyMarketFailureFromText(
    `${status.state} ${status.warning ?? ""} ${status.note ?? ""}`,
  );
}

export function marketFailureCopy(kind: MarketFailureKind): string {
  switch (kind) {
    case "api_ban":
      return "The grading source blocked or rate-limited this lookup (Cloudflare / API ban), not a missing card identity in this app.";
    case "timeout":
      return "The grading source timed out inside the card-detail budget. A retry can recover once the source answers.";
    case "code":
      return "A provider or parser error failed this lookup. This is an app/source-integration issue, not a missing print.";
    case "no_match":
      return "The connected sources did not find a matching product for this print.";
    default:
      return "";
  }
}

export function summarizeMarketSourceFailures(statuses: MarketSourceStatus[] | undefined) {
  const list = statuses ?? [];
  const hasDeferredSources = list.some((status) => status.state === "partial");
  const interesting = list.filter((status) => {
    if (/catalog|app market cache/i.test(status.source)) {
      return false;
    }

    if (
      hasDeferredSources &&
      (status.state === "timeout" || status.state === "circuit_open")
    ) {
      return false;
    }

    return classifyMarketSourceFailure(status) !== "ok";
  });

  if (!interesting.length) {
    return null;
  }

  const kinds = interesting.map((status) => classifyMarketSourceFailure(status));
  const kind: MarketFailureKind = kinds.includes("api_ban")
    ? "api_ban"
    : kinds.includes("timeout")
      ? "timeout"
      : kinds.includes("code")
        ? "code"
        : "no_match";

  return {
    kind,
    sources: interesting.map((status) => status.source),
    copy: marketFailureCopy(kind),
    statuses: interesting,
  };
}

export function retryableMarketFailureState(
  error: unknown,
): Extract<MarketSourceStatus["state"], "timeout" | "circuit_open" | "provider_error"> {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const kind = classifyMarketFailureFromText(message);

  if (kind === "api_ban") {
    return "circuit_open";
  }

  if (kind === "timeout") {
    return "timeout";
  }

  return "provider_error";
}
