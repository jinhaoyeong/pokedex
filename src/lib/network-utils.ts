import "server-only";

export type FetchWithEvasionOptions = RequestInit & {
  language?: string;
  timeoutMs?: number;
  allowTrustedProxy?: boolean;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const BROWSER_USER_AGENT =
  process.env.MARKET_HTTP_BROWSER_USER_AGENT?.trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function acceptLanguage(language?: string) {
  const lower = language?.toLowerCase();

  if (lower === "ja") {
    return "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.6";
  }

  if (lower === "zh-cn") {
    return "zh-CN,zh;q=0.9,en-US;q=0.7,en;q=0.6";
  }

  if (lower === "zh-tw") {
    return "zh-TW,zh;q=0.9,en-US;q=0.7,en;q=0.6";
  }

  return "en-US,en;q=0.9";
}

function headerEntries(headers?: HeadersInit) {
  if (!headers) {
    return {};
  }

  return Object.fromEntries(new Headers(headers).entries());
}

function browserHeaders(options: FetchWithEvasionOptions) {
  return {
    "User-Agent": BROWSER_USER_AGENT,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": acceptLanguage(options.language),
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    ...headerEntries(options.headers),
  };
}

function trustedProxyUrl(targetUrl: string) {
  const base = process.env.MARKET_HTTP_TRUSTED_PROXY_URL?.trim();

  if (!base) {
    return "";
  }

  const url = new URL(base);
  url.searchParams.set("url", targetUrl);
  return url.toString();
}

async function directFetch(url: string, options: FetchWithEvasionOptions) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  return fetch(url, {
    ...options,
    headers: browserHeaders(options),
    signal,
  });
}

/**
 * Browser-compatible market fetch.
 *
 * This intentionally does not use open proxy lists or public anonymizers. If a
 * team-owned forward proxy is configured via MARKET_HTTP_TRUSTED_PROXY_URL, it
 * can be used as a best-effort fallback only by callers that explicitly opt in.
 */
export async function fetchWithEvasion(url: string, options: FetchWithEvasionOptions = {}) {
  const response = await directFetch(url, options).catch((error) => {
    if (!options.allowTrustedProxy) {
      throw error;
    }

    return null;
  });

  if (response && (response.ok || !options.allowTrustedProxy || ![401, 403, 429].includes(response.status))) {
    return response;
  }

  const proxy = trustedProxyUrl(url);

  if (!proxy) {
    return response ?? directFetch(url, options);
  }

  return directFetch(proxy, {
    ...options,
    allowTrustedProxy: false,
    headers: {
      ...browserHeaders(options),
      "X-Target-URL": url,
    },
  });
}
