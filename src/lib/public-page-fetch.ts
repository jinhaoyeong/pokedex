import {
  isHostCircuitOpen,
  recordHostFailure as recordGovernedHostFailure,
  recordHostSuccess as recordGovernedHostSuccess,
  runGovernedHostRequest,
} from "@/lib/market/host-governor";
import { isPublicHtmlTransportBlocked } from "@/lib/market/source-failure";

const PUBLIC_FETCH_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const PUBLIC_PAGE_TIMEOUT_MS = Number(process.env.PUBLIC_PAGE_TIMEOUT_MS ?? "10000");
/** Magery sold-comp pages routinely need >10s; keep a dedicated budget so the
 *  shared 10s default does not trip the circuit on every canary. */
const MAGERY_PAGE_TIMEOUT_MS = Number(process.env.MAGERY_PAGE_TIMEOUT_MS ?? "18000");
const PUBLIC_READER_TIMEOUT_MS = 12_000;
/** PriceCharting English product pages need the HTML reader payload (pop_data /
 *  price grid). Markdown-only responses omit those and look like "no match". */
const PUBLIC_READER_HTML_TIMEOUT_MS = Number(
  process.env.PUBLIC_READER_HTML_TIMEOUT_MS ?? "8000",
);
const PUBLIC_PAGE_MAX_ATTEMPTS = 2;

function pageTimeoutMsForHost(host: string) {
  if (host.includes("magery.com")) {
    return MAGERY_PAGE_TIMEOUT_MS;
  }

  if (host.includes("pricecharting.com")) {
    return Number(process.env.PUBLIC_PAGE_PRICECHARTING_TIMEOUT_MS ?? "12000");
  }

  return PUBLIC_PAGE_TIMEOUT_MS;
}

/**
 * Per-host circuit breaker for known slow / rate-limited / bot-walled sources.
 * Those hosts (magery, tcgfish) are otherwise retried + routed through the
 * reader proxy on every gather, burning the time budget for no data. After a
 * few consecutive failures we skip them fast for a cooldown, then re-probe.
 * Scoped to an allowlist so primary sources (catalogs) are never circuit-broken
 * for ordinary transient failures and accuracy is unaffected.
 *
 * Separately, ANY host (PriceCharting included) is circuit-broken when it hard
 * BLOCKS us (401/403) or RATE-LIMITS us (429). Without a 429 cooldown, set
 * browse enrichment keeps firing dozens of scrapes that all fail and flood the
 * terminal. A 403 whose reader fallback SUCCEEDS does not trip the breaker.
 */
const BREAKABLE_HOSTS = (process.env.MARKET_SLOW_SOURCE_HOSTS ?? "magery.com,tcgfish.net")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
// Direct PriceCharting HTML is ~200ms here; the Jina reader is ~5s per URL and
// was blowing the card-detail 8–10s budget. Keep reader as a 401/403 fallback
// (see fetchPublicPageTextUncached) instead of the default first hop.
const READER_FIRST_HOSTS = (process.env.MARKET_READER_FIRST_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 5 * 60_000;
// A hard block (403/401 IP wall) is a strong, non-transient signal, so trip after
// fewer hits and keep the source skipped longer than a generic slow-host failure.
const CIRCUIT_BLOCK_THRESHOLD = 2;
const CIRCUIT_BLOCK_COOLDOWN_MS = 10 * 60_000;
// 429 rate limits should cool down every host (PriceCharting included). Without
// this, set browse enrichment keeps firing dozens of scrapes that all fail.
// Require two consecutive 429s before opening — a single reader/proxy blip
// should not blank PriceCharting population for the whole audit window.
const CIRCUIT_RATE_LIMIT_THRESHOLD = Number(
  process.env.PUBLIC_PAGE_RATE_LIMIT_THRESHOLD ?? "2",
);
const CIRCUIT_RATE_LIMIT_COOLDOWN_MS = Number(
  process.env.PUBLIC_PAGE_RATE_LIMIT_COOLDOWN_MS ?? String(5 * 60_000),
);
const HOST_MIN_INTERVAL_MS = Number(process.env.PUBLIC_PAGE_HOST_INTERVAL_MS ?? "450");
const HOST_JITTER_MS = Number(process.env.PUBLIC_PAGE_HOST_JITTER_MS ?? "180");
/** PriceCharting needs slightly more pacing than Magery during sweep audits. */
const PRICECHARTING_HOST_MIN_INTERVAL_MS = Number(
  process.env.PUBLIC_PAGE_PRICECHARTING_INTERVAL_MS ?? "250",
);

class PublicPageBlockedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PublicPageBlockedError";
    this.status = status;
  }
}

class PublicPageRateLimitedError extends Error {
  readonly status = 429;

  constructor(message: string) {
    super(message);
    this.name = "PublicPageRateLimitedError";
  }
}

class PublicPageNotFoundError extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "PublicPageNotFoundError";
  }
}

/**
 * Jina reader-proxy 429s must not open the PriceCharting circuit. Under audit
 * load the reader trips first; attributing that to www.pricecharting.com blanked
 * population for 15 minutes and left hundreds of cards on pop.pending.
 */
class PublicPageReaderRateLimitedError extends Error {
  readonly status = 429;
  readonly readerHost = "r.jina.ai";

  constructor(message: string) {
    super(message);
    this.name = "PublicPageReaderRateLimitedError";
  }
}

type PublicPageLogRuntime = {
  hostLoggedOpenCircuit: Set<string>;
  hostLoggedRateLimit: Set<string>;
  directBlockedHosts: Set<string>;
};

export type PublicPageFetchOptions = {
  readerFirst?: boolean;
  preferHtml?: boolean;
  priority?: boolean;
  timeoutMs?: number;
};

const globalRuntime = globalThis as typeof globalThis & {
  __pokedexPublicPageLogRuntime?: PublicPageLogRuntime;
};
const publicPageLogRuntime =
  globalRuntime.__pokedexPublicPageLogRuntime ??
  (globalRuntime.__pokedexPublicPageLogRuntime = {
    hostLoggedOpenCircuit: new Set(),
    hostLoggedRateLimit: new Set(),
    directBlockedHosts: new Set(),
  });
if (!publicPageLogRuntime.directBlockedHosts) {
  publicPageLogRuntime.directBlockedHosts = new Set();
}
const { hostLoggedOpenCircuit, hostLoggedRateLimit, directBlockedHosts } = publicPageLogRuntime;

function hostOf(url: string) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function isBreakableHost(host: string) {
  return host.length > 0 && BREAKABLE_HOSTS.some((entry) => host.includes(entry));
}

function isReaderFirstHost(host: string) {
  return host.length > 0 && READER_FIRST_HOSTS.some((entry) => host.includes(entry));
}

export function markPublicHostDirectBlocked(host: string) {
  const key = host.trim().toLowerCase();
  if (key) {
    directBlockedHosts.add(key);
  }
}

export function isPublicHostDirectBlocked(host: string) {
  const key = host.trim().toLowerCase();
  return Boolean(key) && directBlockedHosts.has(key);
}

function shouldPreferReader(host: string) {
  return isReaderFirstHost(host) || isPublicHostDirectBlocked(host) || isHostCircuitOpen(host);
}

function recordHostSuccess(host: string) {
  recordGovernedHostSuccess(host);
  if (!isHostCircuitOpen(host)) {
    hostLoggedOpenCircuit.delete(host);
    hostLoggedRateLimit.delete(host);
  }
}

function recordHostFailure(host: string) {
  recordGovernedHostFailure(host, {
    threshold: CIRCUIT_FAILURE_THRESHOLD,
    cooldownMs: CIRCUIT_COOLDOWN_MS,
  });
}

function recordHostBlock(host: string) {
  recordGovernedHostFailure(host, {
    threshold: CIRCUIT_BLOCK_THRESHOLD,
    cooldownMs: CIRCUIT_BLOCK_COOLDOWN_MS,
  });
}

function recordHostRateLimit(host: string) {
  recordGovernedHostFailure(host, {
    threshold: CIRCUIT_RATE_LIMIT_THRESHOLD,
    cooldownMs: CIRCUIT_RATE_LIMIT_COOLDOWN_MS,
  });
}

function isRateLimitError(error: unknown) {
  if (
    error instanceof PublicPageRateLimitedError ||
    error instanceof PublicPageReaderRateLimitedError
  ) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("too many requests");
}

function hostMinIntervalMs(host: string) {
  if (host.includes("pricecharting.com")) {
    return PRICECHARTING_HOST_MIN_INTERVAL_MS;
  }

  return HOST_MIN_INTERVAL_MS;
}

/** True when scrapes for this host should be skipped (cooldown after 429/block/failures). */
export function isPublicPageCircuitOpen(urlOrHost: string) {
  const host = urlOrHost.includes("://") ? hostOf(urlOrHost) : urlOrHost.toLowerCase();
  return isHostCircuitOpen(host);
}

/** PriceCharting origin HTML is Cloudflare-blocked and Jina cannot recover it. */
export function isPriceChartingPublicHtmlBlocked() {
  const host = "www.pricecharting.com";
  return isPublicHtmlTransportBlocked({
    originDirectBlocked: isPublicHostDirectBlocked(host),
    originCircuitOpen: isHostCircuitOpen(host),
    readerCircuitOpen: isHostCircuitOpen("r.jina.ai"),
  });
}

export function isPublicPageTransportBanError(error: unknown) {
  return (
    error instanceof PublicPageBlockedError ||
    error instanceof PublicPageRateLimitedError ||
    error instanceof PublicPageReaderRateLimitedError ||
    /circuit open|403|401|429|cloudflare|cf-mitigated/i.test(errorMessage(error))
  );
}

function isLikelyBotWallHtml(html: string) {
  return html.length < 12_000 && /\bjust a moment\b/i.test(html);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function fetchReaderText(url: string, options: { preferHtml?: boolean; timeoutMs?: number } = {}) {
  const readerHost = "r.jina.ai";
  const readerUrl = `https://r.jina.ai/${url}`;
  const preferHtml =
    options.preferHtml ?? hostOf(url).includes("pricecharting.com");
  const timeoutMs =
    options.timeoutMs ?? (preferHtml ? PUBLIC_READER_HTML_TIMEOUT_MS : PUBLIC_READER_TIMEOUT_MS);

  if (isHostCircuitOpen(readerHost)) {
    throw new Error(`Skipping ${readerHost}: source circuit open after repeated failures`);
  }

  return runGovernedHostRequest(
    readerHost,
    {
      minIntervalMs: hostMinIntervalMs(readerHost),
      jitterMs: HOST_JITTER_MS,
      circuitMessage: `Skipping ${readerHost}: source circuit open after repeated failures`,
    },
    async () => {
      try {
        const response = await fetch(readerUrl, {
          headers: preferHtml
            ? {
                Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
                "X-Return-Format": "html",
              }
            : {
                Accept: "text/plain, text/markdown, */*;q=0.8",
              },
          next: { revalidate: 43_200 },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          if (response.status === 429) {
            recordHostRateLimit(readerHost);
            throw new PublicPageReaderRateLimitedError(
              `Reader fallback request failed: ${response.status}`,
            );
          }

          throw new Error(`Reader fallback request failed: ${response.status}`);
        }

        const text = await response.text();

        if (text.length < 200 || isLikelyBotWallHtml(text)) {
          throw new Error("Reader fallback did not return usable text");
        }

        recordHostSuccess(readerHost);
        return text;
      } catch (error) {
        if (!(error instanceof PublicPageReaderRateLimitedError)) {
          recordHostFailure(readerHost);
        }
        throw error;
      }
    },
  );
}

function recordPublicPageFailure(host: string, breakable: boolean, error: unknown) {
  if (error instanceof PublicPageReaderRateLimitedError) {
    // Reader transport owns this failure; do not poison the target host.
    return;
  }

  if (error instanceof PublicPageRateLimitedError || isRateLimitError(error)) {
    recordHostRateLimit(host);
  } else if (error instanceof PublicPageBlockedError) {
    if (breakable) {
      recordHostBlock(host);
    }
  } else if (breakable && !errorMessage(error).includes("source circuit open")) {
    recordHostFailure(host);
  }
}

function logPublicPageFailure(url: string, host: string, error: unknown) {
  const message = errorMessage(error);
  const status =
    error instanceof PublicPageBlockedError ||
    error instanceof PublicPageRateLimitedError ||
    error instanceof PublicPageReaderRateLimitedError
      ? error.status
      : undefined;

  // Circuit-open skips are expected after a cooldown trip — log once per host.
  if (message.includes("source circuit open")) {
    if (!hostLoggedOpenCircuit.has(host)) {
      hostLoggedOpenCircuit.add(host);
      console.warn(`[market] Skipping ${host}: circuit open after repeated failures`);
    }
    return;
  }

  if (error instanceof PublicPageReaderRateLimitedError) {
    if (!hostLoggedRateLimit.has(error.readerHost)) {
      hostLoggedRateLimit.add(error.readerHost);
      console.warn(`[market] ${error.readerHost} rate-limited (429); cooling reader proxy only`, {
        url,
        status: 429,
        message,
      });
    }
    return;
  }

  if (isRateLimitError(error)) {
    if (!hostLoggedRateLimit.has(host)) {
      hostLoggedRateLimit.add(host);
      console.warn(`[market] ${host} rate-limited (429); cooling down scrapes`, {
        url,
        status: status ?? 429,
        message,
      });
    }
    return;
  }

  console.error("public market page fetch failed", {
    url,
    host,
    status,
    message,
  });
}

export async function fetchPublicPageText(
  url: string,
  revalidateSeconds = 43_200,
  options: PublicPageFetchOptions = {},
) {
  const host = hostOf(url);
  const breakable = isBreakableHost(host);
  const readerOptions = {
    preferHtml: options.preferHtml,
    timeoutMs: options.priority ? Math.min(options.timeoutMs ?? 4_000, 4_000) : options.timeoutMs,
  };

  if (isPublicHostDirectBlocked(host) && isHostCircuitOpen("r.jina.ai")) {
    throw new PublicPageBlockedError(
      403,
      `Public page request failed: 403; reader fallback skipped: r.jina.ai circuit open`,
    );
  }

  // Skip fast when the circuit is open — either an allowlisted slow host, or any
  // host that recently hard-blocked / rate-limited us. Direct HTML can be blocked
  // by Cloudflare while the independent reader proxy still has the page.
  if (isHostCircuitOpen(host)) {
    if (!isHostCircuitOpen("r.jina.ai")) {
      try {
        return await fetchReaderText(url, readerOptions);
      } catch (readerError) {
        logPublicPageFailure(url, "r.jina.ai", readerError);
      }
    }

    const error = new Error(`Skipping ${host}: source circuit open after repeated failures`);
    logPublicPageFailure(url, host, error);
    throw error;
  }

  try {
    return await runGovernedHostRequest(
      host,
      {
        minIntervalMs: options.priority ? 0 : hostMinIntervalMs(host),
        jitterMs: options.priority ? 0 : HOST_JITTER_MS,
        bypassQueue: options.priority === true,
      },
      async () => {
        try {
          const text = await fetchPublicPageTextUncached(url, revalidateSeconds, options);
          recordHostSuccess(host);
          return text;
        } catch (error) {
          // Record while still holding the host slot, before queued callers run.
          recordPublicPageFailure(host, breakable, error);
          throw error;
        }
      },
    );
  } catch (error) {
    logPublicPageFailure(url, host, error);
    throw error;
  }
}

async function fetchPublicPageTextUncached(
  url: string,
  revalidateSeconds = 43_200,
  options: PublicPageFetchOptions = {},
) {
  const host = hostOf(url);
  let lastError: unknown;
  const maxAttempts = options.priority ? 1 : PUBLIC_PAGE_MAX_ATTEMPTS;
  const directTimeoutMs = options.priority
    ? Math.min(options.timeoutMs ?? 2_500, 2_500)
    : (options.timeoutMs ?? pageTimeoutMsForHost(host));
  const readerOptions = {
    preferHtml: options.preferHtml,
    timeoutMs: options.priority ? Math.min(options.timeoutMs ?? 4_000, 4_000) : options.timeoutMs,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // Cloudflare 403s on the origin are sticky. Once a host has challenged us,
      // skip the doomed direct hop and go through the reader proxy.
      const readerUnavailable = isHostCircuitOpen("r.jina.ai");
      const skipDirect = isPublicHostDirectBlocked(host);
      const readerFirst =
        !readerUnavailable &&
        ((options.readerFirst ?? shouldPreferReader(host)) || skipDirect);

      if (skipDirect && readerUnavailable) {
        throw new PublicPageBlockedError(
          403,
          `Public page request failed: 403; reader fallback skipped: r.jina.ai circuit open`,
        );
      }

      if (readerFirst) {
        try {
          return await fetchReaderText(url, readerOptions);
        } catch (readerError) {
          // Reader-proxy 429: cool down Jina and fall through to a direct
          // PriceCharting fetch. Throwing here used to open the PriceCharting
          // circuit and freeze population for the whole cooldown window.
          if (readerError instanceof PublicPageReaderRateLimitedError) {
            lastError = readerError;
          } else if (
            readerError instanceof PublicPageRateLimitedError ||
            isRateLimitError(readerError)
          ) {
            throw readerError instanceof PublicPageRateLimitedError
              ? readerError
              : new PublicPageRateLimitedError(errorMessage(readerError));
          } else {
            lastError = readerError;
          }

          if (skipDirect) {
            throw readerError;
          }
        }
      }

      const isPriceCharting = host.includes("pricecharting.com");
      const response = await fetch(url, {
        headers: PUBLIC_FETCH_HEADERS,
        ...(isPriceCharting
          ? { cache: "no-store" as const }
          : { next: { revalidate: revalidateSeconds } }),
        signal: AbortSignal.timeout(directTimeoutMs),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new PublicPageRateLimitedError(`Public page request failed: ${response.status}`);
        }

        if (response.status === 401 || response.status === 403) {
          markPublicHostDirectBlocked(host);

          if (readerFirst && lastError) {
            throw lastError instanceof Error
              ? lastError
              : new Error(
                  `Public page request failed: ${response.status}; reader-first fallback failed`,
                );
          }

          try {
            return await fetchReaderText(url, readerOptions);
          } catch (readerError) {
            if (readerError instanceof PublicPageReaderRateLimitedError) {
              throw readerError;
            }

            if (readerError instanceof PublicPageRateLimitedError || isRateLimitError(readerError)) {
              throw readerError instanceof PublicPageRateLimitedError
                ? readerError
                : new PublicPageRateLimitedError(errorMessage(readerError));
            }

            // Direct fetch blocked AND the reader proxy could not recover the page —
            // there is genuinely no data, so surface a typed block error that trips
            // the per-host circuit breaker and stops further hammering of this host.
            throw new PublicPageBlockedError(
              response.status,
              `Public page request failed: ${response.status}; reader fallback failed: ${errorMessage(readerError)}`,
            );
          }
        }

        if (response.status === 404) {
          throw new PublicPageNotFoundError(`Public page request failed: ${response.status}`);
        }

        const retriable =
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (retriable && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }

        throw new Error(`Public page request failed: ${response.status}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;

      // A hard block / rate limit won't clear by retrying the same IP — fail
      // fast so the circuit breaker engages instead of multiplying scrapes.
      if (
        error instanceof PublicPageBlockedError ||
        error instanceof PublicPageRateLimitedError ||
        error instanceof PublicPageReaderRateLimitedError ||
        error instanceof PublicPageNotFoundError
      ) {
        throw error;
      }

      if (isRateLimitError(error)) {
        throw new PublicPageRateLimitedError(errorMessage(error));
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Public page request failed");
}
