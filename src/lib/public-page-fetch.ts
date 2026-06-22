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
 * Scoped to an allowlist so primary sources (PriceCharting, catalogs) are never
 * circuit-broken and accuracy is unaffected.
 */
const BREAKABLE_HOSTS = (process.env.MARKET_SLOW_SOURCE_HOSTS ?? "magery.com,tcgfish.net")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 5 * 60_000;

const hostCircuit = new Map<string, { failures: number; openUntil: number }>();

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

function isLikelyBotWallHtml(html: string) {
  return html.length < 12_000 && /\bjust a moment\b/i.test(html);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function fetchReaderText(url: string) {
  const readerUrl = `https://r.jina.ai/${url}`;
  const response = await fetch(readerUrl, {
    headers: {
      Accept: "text/plain, text/markdown, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": PUBLIC_FETCH_HEADERS["User-Agent"],
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

export async function fetchPublicPageText(url: string, revalidateSeconds = 43_200) {
  const host = hostOf(url);
  const breakable = isBreakableHost(host);

  if (breakable && isCircuitOpen(host)) {
    throw new Error(`Skipping ${host}: source circuit open after repeated failures`);
  }

  try {
    const text = await fetchPublicPageTextUncached(url, revalidateSeconds);
    if (breakable) {
      recordHostSuccess(host);
    }
    return text;
  } catch (error) {
    if (breakable) {
      recordHostFailure(host);
    }
    throw error;
  }
}

async function fetchPublicPageTextUncached(url: string, revalidateSeconds = 43_200) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PUBLIC_PAGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: PUBLIC_FETCH_HEADERS,
        next: { revalidate: revalidateSeconds },
        signal: AbortSignal.timeout(PUBLIC_PAGE_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          try {
            return await fetchReaderText(url);
          } catch (readerError) {
            throw new Error(
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

      if (attempt < PUBLIC_PAGE_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Public page request failed");
}
