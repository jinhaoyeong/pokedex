type JsonRecord = Record<string, unknown>;

type RequestMetric = {
  label: string;
  url: string;
  status: number;
  ok: boolean;
  elapsedMs: number;
  cache: string;
  provider: string;
  price: number | null;
  notes: string[];
  error?: string;
};

type SuiteReport = {
  suite: string;
  endpoint: string;
  requestCount: number;
  successCount: number;
  minMs: number;
  avgMs: number;
  maxMs: number;
  winnerProvider: string;
  cacheStatus: string;
  pass: boolean;
  notes: string;
};

const BASE_URL = process.env.FINAL_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const CARD_DETAIL_SLUG =
  process.env.FINAL_SMOKE_CARD_SLUG ?? "ja--official-201-charizard-ex-sv2a";
const SEARCH_CONCURRENCY = Number(process.env.FINAL_SMOKE_SEARCH_CONCURRENCY ?? "8");
const CARD_CONCURRENCY = Number(process.env.FINAL_SMOKE_CARD_CONCURRENCY ?? "8");
const PRICE_CONCURRENCY = Number(process.env.FINAL_SMOKE_PRICE_CONCURRENCY ?? "20");
const RUN_ID = Date.now();

function percentile(values: number[], quantile: number) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : 0;
}

function cacheStatus(headers: Headers) {
  const memory = headers.get("x-memory-cache");
  const vercel = headers.get("x-vercel-cache");
  const cacheControl = headers.get("cache-control");

  if (memory) {
    return `memory:${memory}`;
  }

  if (vercel) {
    return `edge:${vercel}`;
  }

  if (cacheControl?.includes("no-store")) {
    return "no-store";
  }

  return cacheControl ? "cacheable" : "none";
}

function providerFromPayload(payload: JsonRecord | null) {
  const results = Array.isArray(payload?.results) ? (payload.results as JsonRecord[]) : [];

  return (
    stringValue(payload?.primaryProvider) ||
    stringValue(payload?.provider) ||
    stringValue(results.find((result) => result.provider)?.provider) ||
    "none"
  );
}

function priceFromPayload(payload: JsonRecord | null) {
  const prices = recordValue(payload?.prices);

  return (
    numberValue(payload?.marketPrice) ??
    numberValue(payload?.ungradedUsd) ??
    numberValue(prices?.market) ??
    numberValue(prices?.ungraded) ??
    null
  );
}

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function hit(label: string, url: string): Promise<RequestMetric> {
  const started = performance.now();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    const elapsedMs = Math.round(performance.now() - started);
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as JsonRecord) : null;
    const notes: string[] = [];

    if (payload?.error) {
      notes.push(`error=${String(payload.error)}`);
    }

    return {
      label,
      url,
      status: response.status,
      ok: response.ok,
      elapsedMs,
      cache: cacheStatus(response.headers),
      provider: providerFromPayload(payload),
      price: priceFromPayload(payload),
      notes,
    };
  } catch (error) {
    return {
      label,
      url,
      status: 0,
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      cache: "none",
      provider: "none",
      price: null,
      notes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runBatch(label: string, url: string, count: number) {
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, index) => hit(`${label}-${index + 1}`, url)),
  );

  return settled.map((entry, index): RequestMetric =>
    entry.status === "fulfilled"
      ? entry.value
      : {
          label: `${label}-${index + 1}`,
          url,
          status: 0,
          ok: false,
          elapsedMs: 0,
          cache: "none",
          provider: "none",
          price: null,
          notes: [],
          error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
        },
  );
}

function summarize(
  suite: string,
  endpoint: string,
  metrics: RequestMetric[],
  pass: boolean,
  notes: string[],
): SuiteReport {
  const times = metrics.map((metric) => metric.elapsedMs).filter((value) => value >= 0);
  const providerCounts = new Map<string, number>();
  const cacheCounts = new Map<string, number>();

  for (const metric of metrics) {
    providerCounts.set(metric.provider, (providerCounts.get(metric.provider) ?? 0) + 1);
    cacheCounts.set(metric.cache, (cacheCounts.get(metric.cache) ?? 0) + 1);
  }

  const winnerProvider =
    [...providerCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "none";
  const cacheStatusText =
    [...cacheCounts.entries()]
      .map(([cache, count]) => `${cache}:${count}`)
      .join(", ") || "none";

  return {
    suite,
    endpoint,
    requestCount: metrics.length,
    successCount: metrics.filter((metric) => metric.ok).length,
    minMs: times.length ? Math.min(...times) : 0,
    avgMs: average(times),
    maxMs: times.length ? Math.max(...times) : 0,
    winnerProvider,
    cacheStatus: cacheStatusText,
    pass,
    notes: notes.join("; "),
  };
}

function searchUrl() {
  const params = new URLSearchParams({
    q: "pikachu",
    page: "1",
    lang: "all",
    sort: "relevance",
  });

  return `${BASE_URL}/api/live-search?${params.toString()}`;
}

function cardUrl() {
  return `${BASE_URL}/api/cards/${encodeURIComponent(CARD_DETAIL_SLUG)}`;
}

function priceUrl() {
  const params = new URLSearchParams({
    id: "ja--official-SV2a-201",
    slug: `ja--official-stress-failover-final-${RUN_ID}`,
    cardId: "sv2a-201",
    name: "Charizard ex",
    englishName: "Charizard ex",
    language: "ja",
    setCode: "SV2a",
    setName: "Pokemon Card 151",
    setEnglishName: "Pokemon Card 151",
    number: "201/165",
    rarity: "Special Illustration Rare",
  });

  return `${BASE_URL}/api/price?${params.toString()}`;
}

async function suiteSearch() {
  const url = searchUrl();
  const cold = await hit("search-cold", url);
  const warm = await hit("search-warm", url);
  const batch = await runBatch("search-batch", url, SEARCH_CONCURRENCY);
  const metrics = [cold, warm, ...batch];
  const p95 = percentile(metrics.map((metric) => metric.elapsedMs), 0.95);
  const pass =
    metrics.every((metric) => metric.ok) &&
    cold.elapsedMs < 150 &&
    warm.elapsedMs < 150 &&
    p95 < 150;

  return summarize("A. Live Search", "/api/live-search?q=pikachu", metrics, pass, [
    `cold=${cold.elapsedMs}ms`,
    `warm=${warm.elapsedMs}ms`,
    `p95=${p95}ms`,
    pass ? "sub-150ms target met" : "sub-150ms target missed",
  ]);
}

async function suiteCardDetails() {
  const url = cardUrl();
  const cold = await hit("card-cold", url);
  const warm = await hit("card-warm", url);
  const batch = await runBatch("card-batch", url, CARD_CONCURRENCY);
  const metrics = [cold, warm, ...batch];
  const pass =
    metrics.every((metric) => metric.ok) &&
    metrics.every((metric) => metric.elapsedMs < 1000) &&
    !metrics.some((metric) => metric.notes.some((note) => /enrichGrading/i.test(note)));

  return summarize("B. Card Details", `/api/cards/${CARD_DETAIL_SLUG}`, metrics, pass, [
    `cold=${cold.elapsedMs}ms`,
    `warm=${warm.elapsedMs}ms`,
    "grading enrichment expected lazy/not blocking",
  ]);
}

async function suitePricing() {
  const url = priceUrl();
  const cold = await hit("price-cold", url);
  const warm = await hit("price-warm", url);
  const batch = await runBatch("price-batch", url, PRICE_CONCURRENCY);
  const metrics = [cold, warm, ...batch];
  const warmMetrics = [warm, ...batch];
  const allCollectr = metrics.every((metric) => metric.provider === "collectr-fallback");
  const allPriceMapped = metrics.every((metric) => metric.price === 399.99);
  const warmUnder1000 = warmMetrics.every((metric) => metric.elapsedMs < 1000);
  const hasMemoryHit = metrics.some((metric) => metric.cache === "memory:hit");
  const pass =
    metrics.every((metric) => metric.ok) &&
    allCollectr &&
    allPriceMapped &&
    warmUnder1000 &&
    hasMemoryHit;

  return summarize("C. Pricing Failover", "/api/price stress-failover", metrics, pass, [
    `cold=${cold.elapsedMs}ms`,
    `warm=${warm.elapsedMs}ms`,
    allCollectr ? "winner=Collectr" : "winner mismatch",
    allPriceMapped ? "market=399.99" : "market mismatch",
    warmUnder1000 ? "warm/concurrent sub-1000ms" : "warm/concurrent >=1000ms",
  ]);
}

function printReport(reports: SuiteReport[]) {
  console.log("# Final Smoke Test Report");
  console.log("");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log("");
  console.log(
    "| Suite | Endpoint | Requests | Success | Min/Avg/Max Latency | Winner Provider | Cache Status | Result | Notes |",
  );
  console.log(
    "|---|---|---:|---:|---|---|---|---|---|",
  );

  for (const report of reports) {
    const successRate = `${report.successCount}/${report.requestCount}`;
    const latency = `${report.minMs}/${report.avgMs}/${report.maxMs}ms`;
    console.log(
      `| ${report.suite} | \`${report.endpoint}\` | ${report.requestCount} | ${successRate} | ${latency} | ${report.winnerProvider} | ${report.cacheStatus} | ${report.pass ? "PASS" : "FAIL"} | ${report.notes} |`,
    );
  }

  console.log("");
  const passed = reports.filter((report) => report.pass).length;
  console.log(`Overall: ${passed}/${reports.length} suites passed`);
}

async function main() {
  console.log("Running final smoke test...");
  console.log("");

  const reports = await Promise.all([suiteSearch(), suiteCardDetails(), suitePricing()]);
  printReport(reports);
}

void main();

export {};
