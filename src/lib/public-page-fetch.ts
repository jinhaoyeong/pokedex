const PUBLIC_FETCH_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const PUBLIC_PAGE_TIMEOUT_MS = 10_000;
const PUBLIC_READER_TIMEOUT_MS = 12_000;
const PUBLIC_PAGE_MAX_ATTEMPTS = 2;

/**
 * Per-host circuit breaker for known slow / rate-limited / bot-walled sources.
 * Those hosts (magery, tcgfish) are otherwise retried + routed through the
 * reader proxy on every gather, burning the time budget for no data. After a
 * few consecutive failures we skip them fast for a cooldown, then re-probe.
 * Scoped to an allowlist so primary sources (catalogs) are never circuit-broken
 * for ordinary transient failures and accuracy is unaffected.
 *
 * Separately, ANY host (PriceCharting included) is circuit-broken when it hard
 * BLOCKS us — a 401/403 IP wall where the reader-proxy fallback also fails, i.e.
 * we genuinely can't get data. When PriceCharting blocks the IP, every card would
 * otherwise re-pay a 403 + a 12s reader timeout; this skips the source fast for a
 * cooldown instead of flooding hundreds of failed fetches, then re-probes. A 403
 * whose reader fallback SUCCEEDS does not trip the breaker, so accuracy is intact.
 */
const BREAKABLE_HOSTS = (process.env.MARKET_SLOW_SOURCE_HOSTS ?? "magery.com,tcgfish.net")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const READER_FIRST_HOSTS = (process.env.MARKET_READER_FIRST_HOSTS ?? "pricecharting.com")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 5 * 60_000;
// A hard block (403/401 IP wall) is a strong, non-transient signal, so trip after
// fewer hits and keep the source skipped longer than a generic slow-host failure.
const CIRCUIT_BLOCK_THRESHOLD = 2;
const CIRCUIT_BLOCK_COOLDOWN_MS = 10 * 60_000;
const HOST_MIN_INTERVAL_MS = Number(process.env.PUBLIC_PAGE_HOST_INTERVAL_MS ?? "450");
const HOST_JITTER_MS = Number(process.env.PUBLIC_PAGE_HOST_JITTER_MS ?? "180");

class PublicPageBlockedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PublicPageBlockedError";
    this.status = status;
  }
}

const hostCircuit = new Map<string, { failures: number; openUntil: number }>();
const hostLastRequestAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<void>>();

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

function isCircuitOpen(host: string) {
  const state = hostCircuit.get(host);
  return Boolean(state && state.openUntil > Date.now());
}

function recordHostSuccess(host: string) {
  if (hostCircuit.has(host)) {
    hostCircuit.delete(host);
  }
}

function recordHostFailure(host: string) {
  const state = hostCircuit.get(host) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  }
  hostCircuit.set(host, state);
}

function recordHostBlock(host: string) {
  if (!host) {
    return;
  }

  const state = hostCircuit.get(host) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= CIRCUIT_BLOCK_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_BLOCK_COOLDOWN_MS;
  }
  hostCircuit.set(host, state);
}

function isLikelyBotWallHtml(html: string) {
  return html.length < 12_000 && /\bjust a moment\b/i.test(html);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function waitForHostBudget(host: string) {
  if (!host || HOST_MIN_INTERVAL_MS <= 0) {
    return;
  }

  const previous = hostQueue.get(host) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const elapsed = Date.now() - (hostLastRequestAt.get(host) ?? 0);
      const jitter = HOST_JITTER_MS > 0 ? Math.floor(Math.random() * HOST_JITTER_MS) : 0;
      const waitMs = Math.max(0, HOST_MIN_INTERVAL_MS + jitter - elapsed);

      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      hostLastRequestAt.set(host, Date.now());
    });

  hostQueue.set(host, next);
  await next;
}

async function fetchReaderText(url: string) {
  const readerUrl = `https://r.jina.ai/${url}`;
  const response = await fetch(readerUrl, {
    headers: {
      Accept: "text/plain, text/markdown, */*;q=0.8",
    },
    next: { revalidate: 43_200 },
    signal: AbortSignal.timeout(PUBLIC_READER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Reader fallback request failed: ${response.status}`);
  }

  const text = await response.text();

  if (text.length < 200 || isLikelyBotWallHtml(text)) {
    throw new Error("Reader fallback did not return usable text");
  }

  return text;
}

export async function fetchPublicPageText(
  url: string,
  revalidateSeconds = 43_200,
  options: { readerFirst?: boolean } = {},
) {
  const host = hostOf(url);
  const breakable = isBreakableHost(host);

  // Skip fast when the circuit is open — either an allowlisted slow host, or any
  // host that recently hard-blocked us (403/401 IP wall with no reader fallback).
  if (isCircuitOpen(host)) {
    throw new Error(`Skipping ${host}: source circuit open after repeated failures`);
  }

  try {
    await waitForHostBudget(host);
    const text = await fetchPublicPageTextUncached(url, revalidateSeconds, options);
    recordHostSuccess(host);
    return text;
  } catch (error) {
    console.error("public market page fetch failed", {
      url,
      host,
      status: error instanceof PublicPageBlockedError ? error.status : undefined,
      message: errorMessage(error),
    });

    if (error instanceof PublicPageBlockedError) {
      // Hard blocks only trip optional/slow hosts. Core guide sources can still
      // recover through reader-first fetches and should not be globally blanked.
      if (breakable) {
        recordHostBlock(host);
      }
    } else if (breakable) {
      recordHostFailure(host);
    }
    throw error;
  }
}

async function fetchPublicPageTextUncached(
  url: string,
  revalidateSeconds = 43_200,
  options: { readerFirst?: boolean } = {},
) {
  const host = hostOf(url);
  const readerFirst = options.readerFirst ?? isReaderFirstHost(host);
  let lastError: unknown;

  for (let attempt = 1; attempt <= PUBLIC_PAGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      if (readerFirst) {
        try {
          return await fetchReaderText(url);
        } catch (readerError) {
          lastError = readerError;
        }
      }

      const response = await fetch(url, {
        headers: PUBLIC_FETCH_HEADERS,
        next: { revalidate: revalidateSeconds },
        signal: AbortSignal.timeout(PUBLIC_PAGE_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          if (readerFirst && lastError) {
            throw lastError instanceof Error
              ? lastError
              : new Error(
                  `Public page request failed: ${response.status}; reader-first fallback failed`,
                );
          }

          try {
            return await fetchReaderText(url);
          } catch (readerError) {
            // Direct fetch blocked AND the reader proxy could not recover the page —
            // there is genuinely no data, so surface a typed block error that trips
            // the per-host circuit breaker and stops further hammering of this host.
            throw new PublicPageBlockedError(
              response.status,
              `Public page request failed: ${response.status}; reader fallback failed: ${errorMessage(readerError)}`,
            );
          }
        }

        const retriable =
          response.status === 429 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (retriable && attempt < PUBLIC_PAGE_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }

        throw new Error(`Public page request failed: ${response.status}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;

      // A hard block won't clear by retrying the same IP — fail fast so the
      // circuit breaker engages instead of doubling the wasted reader timeout.
      if (error instanceof PublicPageBlockedError) {
        throw error;
      }

      if (attempt < PUBLIC_PAGE_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Public page request failed");
}
