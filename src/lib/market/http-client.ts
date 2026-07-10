import "server-only";

import {
  isHostCircuitOpen,
  recordHostFailure as recordGovernedHostFailure,
  recordHostSuccess as recordGovernedHostSuccess,
  runGovernedHostRequest,
} from "@/lib/market/host-governor";
import { fetchWithEvasion } from "@/lib/network-utils";

export type MarketHttpErrorCode =
  | "blocked"
  | "circuit_open"
  | "http_error"
  | "network_error"
  | "rate_limited"
  | "timeout";

export class MarketHttpError extends Error {
  readonly code: MarketHttpErrorCode;
  readonly status?: number;
  readonly url: string;

  constructor(code: MarketHttpErrorCode, message: string, url: string, status?: number) {
    super(message);
    this.name = "MarketHttpError";
    this.code = code;
    this.status = status;
    this.url = url;
  }
}

export type MarketHttpOptions = {
  accept?: "html" | "json" | "text";
  headers?: Record<string, string>;
  language?: string;
  revalidateSeconds?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REVALIDATE_SECONDS = 43_200;
const DEFAULT_USER_AGENT =
  process.env.MARKET_HTTP_USER_AGENT?.trim() ||
  "PokePokedexMarketBot/1.0 (+https://github.com/jinhaoyeong/pokedex; contact: owner)";
const HOST_MIN_INTERVAL_MS = Number(process.env.MARKET_HTTP_HOST_INTERVAL_MS ?? "650");
const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.MARKET_HTTP_CIRCUIT_THRESHOLD ?? "3");
const CIRCUIT_COOLDOWN_MS = Number(process.env.MARKET_HTTP_CIRCUIT_COOLDOWN_MS ?? "300000");

function hostOf(url: string) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function acceptHeader(accept: MarketHttpOptions["accept"]) {
  if (accept === "json") {
    return "application/json, text/plain;q=0.8, */*;q=0.5";
  }

  if (accept === "text") {
    return "text/plain, text/markdown;q=0.8, */*;q=0.5";
  }

  return "text/html,application/xhtml+xml,application/xml;q=0.8,text/plain;q=0.6,*/*;q=0.4";
}

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

function isLikelyBlockPage(text: string) {
  return (
    text.length < 40_000 &&
    /\b(just a moment|checking your browser|attention required|cf-ray|cloudflare)\b/i.test(text)
  );
}

function recordHostSuccess(host: string) {
  recordGovernedHostSuccess(host);
}

function recordHostFailure(host: string, openImmediately = false) {
  recordGovernedHostFailure(host, {
    threshold: CIRCUIT_FAILURE_THRESHOLD,
    cooldownMs: CIRCUIT_COOLDOWN_MS,
    openImmediately,
  });
}

/**
 * Compliance-first market HTTP client.
 *
 * This intentionally does not spoof TLS fingerprints, evade browser challenges,
 * or rotate proxies. It gives every provider consistent timeouts, pacing,
 * transparent block detection, and circuit breaking so one protected source
 * cannot stall the app or poison unrelated providers.
 */
export async function fetchMarketText(
  url: string,
  options: MarketHttpOptions = {},
): Promise<string> {
  const host = hostOf(url);

  if (isHostCircuitOpen(host)) {
    throw new MarketHttpError(
      "circuit_open",
      `Skipping ${host}: recent market requests were blocked or failed`,
      url,
    );
  }

  return runGovernedHostRequest(
    host,
    {
      minIntervalMs: HOST_MIN_INTERVAL_MS,
      signal: options.signal,
      circuitMessage: `Skipping ${host}: recent market requests were blocked or rate-limited`,
    },
    async () => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const headers = {
      Accept: acceptHeader(options.accept ?? "html"),
      "Accept-Language": acceptLanguage(options.language),
      "User-Agent": DEFAULT_USER_AGENT,
      ...options.headers,
    };

    try {
      const response = await fetchWithEvasion(url, {
        headers,
        next: { revalidate: options.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS },
        signal,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        language: options.language,
        allowTrustedProxy: false,
      });

      if (response.status === 401 || response.status === 403) {
        recordHostFailure(host);
        throw new MarketHttpError(
          "blocked",
          `Market source blocked the request with HTTP ${response.status}`,
          url,
          response.status,
        );
      }

      if (response.status === 429) {
        // A 429 is authoritative; open the host circuit immediately so queued
        // population/guide variants cannot continue the burst.
        recordHostFailure(host, true);
        throw new MarketHttpError(
          "rate_limited",
          "Market source rate-limited the request",
          url,
          429,
        );
      }

      if (!response.ok) {
        recordHostFailure(host);
        throw new MarketHttpError(
          "http_error",
          `Market source returned HTTP ${response.status}`,
          url,
          response.status,
        );
      }

      const text = await response.text();

      if (isLikelyBlockPage(text)) {
        recordHostFailure(host);
        throw new MarketHttpError(
          "blocked",
          "Market source returned an anti-bot or browser-check page",
          url,
          response.status,
        );
      }

      recordHostSuccess(host);
      return text;
    } catch (error) {
      if (error instanceof MarketHttpError) {
        throw error;
      }

      recordHostFailure(host);
      const aborted = error instanceof DOMException && error.name === "TimeoutError";
      throw new MarketHttpError(
        aborted ? "timeout" : "network_error",
        error instanceof Error ? error.message : "Market source request failed",
        url,
      );
    }
    },
  ).catch((error) => {
    if (
      error instanceof MarketHttpError ||
      !(error instanceof Error) ||
      !error.message.includes("recent market requests were blocked or rate-limited")
    ) {
      throw error;
    }

    throw new MarketHttpError("circuit_open", error.message, url);
  });
}

export async function fetchMarketJson<T>(
  url: string,
  options: Omit<MarketHttpOptions, "accept"> = {},
): Promise<T | null> {
  const text = await fetchMarketText(url, { ...options, accept: "json" });

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MarketHttpError("http_error", "Market source returned invalid JSON", url);
  }
}
