import "server-only";

import {
  classifyLocalizedPriceChartingSetSlug,
  getLocalizedSetMarketProfile,
  isSuspiciouslyLowCatalogPrice,
} from "@/lib/localized-set-market";
import { isTcgdexStyleJapaneseCardId } from "@/lib/price/japanese-list-price";
import { inferEnglishNameFromTcgdexLocalizedName } from "@/lib/tcgdex-japanese-name";
import {
  readMarketFileCache,
  writeMarketFileCache,
} from "@/lib/market/file-cache.server";
import { getOfficialJapaneseSetSupplementById } from "@/lib/official-japanese-sets.server";
import {
  buildLocalizedSlug,
  formatBilingualName,
  normalizeSetCode,
} from "@/lib/pokemon-tcg/text-and-collector-utils";
import { resolvePriceChartingSetSlugs } from "@/lib/pricecharting-set-discovery";
import { fetchPublicPageText, isPublicPageCircuitOpen } from "@/lib/public-page-fetch";
import type { CardFinishId, GradedPrice, TcgCard } from "@/types/pokemon";
import {
  attachFinishMarketsToCard,
  isFirstEditionFinish,
  mergeFinishMarkets,
  parseCardFinishId,
  productUrlMatchesFinish,
  setHasFirstEditionPrints,
} from "@/lib/card-finish";

import type { ProviderPriceResult } from "@/lib/price/types";

/**
 * SET-LEVEL PriceCharting guide cache.
 *
 * A single PriceCharting console page (`/console/pokemon-japanese-abyss-eye`)
 * lists EVERY card in the set — base prints AND secret rares — with Ungraded /
 * Grade 9 / PSA 10 guide prices. Browsing a Japanese set used to fire one
 * public-page scrape PER CARD (81+ reader-proxy requests per set view), which
 * rate-limited the proxy, opened the PriceCharting circuit breaker, and left
 * most cards on "Price pending". This module fetches the console page ONCE per
 * set (file-cached, in-flight-deduped) and answers per-card price lookups from
 * that shared snapshot.
 */

export type PriceChartingSetGuideEntry = {
  /** Product display name without the trailing "#N", e.g. "Mega Darkrai ex". */
  name: string;
  /** Printed collector number base with no leading zeros, e.g. "114". */
  numberBase: string;
  ungradedUsd: number;
  grade9Usd: number;
  psa10Usd: number;
  productUrl: string;
  /** PriceCharting numeric product id when the row carried it. */
  productId?: string;
  /** Product thumbnail (storage.googleapis.com/images.pricecharting.com/…). */
  imageUrl?: string;
};

export type PriceChartingSetGuide = {
  slug: string;
  url: string;
  fetchedAt: string;
  entries: PriceChartingSetGuideEntry[];
  /** True when only the first console page was fetched (enough for #001 browse). */
  partial?: boolean;
};

const SET_GUIDE_TTL_MS = Number(
  process.env.PRICECHARTING_SET_GUIDE_TTL_MS ?? String(12 * 60 * 60 * 1000),
);
// A console page renders up to ~50 rows per cursor window; large JP sets
// (Shiny Treasure ex ≈ 360 cards) need a few cursor hops. Bounded hard so a
// parser regression can never turn into an unbounded crawl.
const SET_GUIDE_MAX_PAGES = Number(process.env.PRICECHARTING_SET_GUIDE_MAX_PAGES ?? "10");
const SET_GUIDE_FULL_PAGE_ROWS = 45;
// Failed slugs are remembered briefly so 81 concurrent card lookups on a set
// with no guide page do not retry the same dead URL 81 times.
const SET_GUIDE_NEGATIVE_TTL_MS = 30 * 60_000;

const guideInFlight = new Map<string, Promise<PriceChartingSetGuide | null>>();
const headInFlight = new Map<string, Promise<PriceChartingSetGuide | null>>();
const guideNegativeCache = new Map<string, number>();

function nowIso() {
  return new Date().toISOString();
}

function dollars(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

function firstDollar(cell: string) {
  return dollars(cell.match(/\$([0-9][0-9,.]*)/)?.[1]);
}

function normalizeNumberBase(value: string) {
  return value.trim().split("/")[0]?.replace(/^0+(?=\d)/, "") ?? "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeNameText(value: string) {
  return decodeHtmlEntities(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Jina reader markdown rows look like:
 * `| [Mega Darkrai ex #114](https://www.pricecharting.com/game/<set>/mega-darkrai-ex-114) | $300.86 | $400.00 | $602.83 | …`
 * Image links in the same table render as `[![Image 3](…)](…)` and never match
 * the `name #number` link-text shape, so they are skipped naturally.
 */
function parseMarkdownGuideRows(text: string): PriceChartingSetGuideEntry[] {
  const entries: PriceChartingSetGuideEntry[] = [];
  const rowPattern =
    /\[([^\[\]]*?)\s*#(\d+[a-zA-Z]?)([^\[\]]*?)\]\((https:\/\/www\.pricecharting\.com\/game\/[^)\s"]+)\)\s*\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)/;
  // The image cell precedes the title cell in the same row and carries the
  // product thumbnail plus the numeric product id as the link title:
  // `[![Image 3](https://storage.googleapis.com/images.pricecharting.com/<hash>/60.jpg)](https://…/game/… "13077406")`
  const imagePattern =
    /!\[[^\]]*\]\((https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^)\s]+)\)\]\([^)]*"(\d+)"\)/;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(rowPattern);

    if (!match) {
      continue;
    }

    const name = decodeHtmlEntities(`${match[1].trim()} ${match[3] ?? ""}`.trim());
    const numberBase = normalizeNumberBase(match[2]);

    if (!name || !numberBase) {
      continue;
    }

    const imageMatch = line.match(imagePattern);

    entries.push({
      name,
      numberBase,
      productUrl: match[4],
      ungradedUsd: firstDollar(match[5]),
      grade9Usd: firstDollar(match[6]),
      psa10Usd: firstDollar(match[7]),
      productId: imageMatch?.[2],
      imageUrl: imageMatch?.[1],
    });
  }

  return entries;
}

/**
 * Direct-HTML fallback (used when the reader proxy returns raw HTML or the
 * direct fetch succeeds): one `<tr>` per product with a `/game/...` title link
 * and `$` guide cells in Ungraded / Grade 9 / PSA 10 order.
 */
function parseHtmlGuideRows(html: string): PriceChartingSetGuideEntry[] {
  const entries: PriceChartingSetGuideEntry[] = [];

  for (const chunk of html.split(/<tr[\s>]/i).slice(1)) {
    const titleMatch = chunk.match(
      /href="((?:https:\/\/www\.pricecharting\.com)?\/game\/[^"]+)"[^>]*>\s*([^<]*#\d+[a-zA-Z]?[^<]*)</i,
    );

    if (!titleMatch) {
      continue;
    }

    const title = titleMatch[2].replace(/\s+/g, " ").trim();
    const nameMatch = title.match(/^(.*?)\s*#(\d+[a-zA-Z]?)(?:\s+(.*))?$/);

    if (!nameMatch) {
      continue;
    }

    const prices = [...chunk.matchAll(/\$([0-9][0-9,.]*)/g)].map((match) => dollars(match[1]));
    const href = titleMatch[1];
    const productId =
      chunk.match(/\bdata-product-id=["'](\d+)["']/i)?.[1] ??
      chunk.match(/(?:[?&]|&amp;)id=(\d+)\b/i)?.[1];

    entries.push({
      name: decodeHtmlEntities(`${nameMatch[1].trim()} ${nameMatch[3] ?? ""}`.trim()),
      numberBase: normalizeNumberBase(nameMatch[2]),
      productUrl: href.startsWith("http") ? href : `https://www.pricecharting.com${href}`,
      ungradedUsd: prices[0] ?? 0,
      grade9Usd: prices[1] ?? 0,
      psa10Usd: prices[2] ?? 0,
      productId,
    });
  }

  return entries;
}

function parseGuidePage(text: string): PriceChartingSetGuideEntry[] {
  const markdown = parseMarkdownGuideRows(text);
  return markdown.length ? markdown : parseHtmlGuideRows(text);
}

async function fetchGuidePages(
  slug: string,
  options: { maxPages?: number; preferDirectHtml?: boolean } = {},
): Promise<PriceChartingSetGuide | null> {
  const baseUrl = `https://www.pricecharting.com/console/${slug}`;
  const byProductUrl = new Map<string, PriceChartingSetGuideEntry>();
  // PriceCharting paginates console pages in FIXED 50-row windows (?cursor=0,
  // 50, 100 …). The first render often carries more than one window, so the
  // next cursor jumps to the last fully-covered window boundary — walking by
  // "entries collected so far" instead lands mid-window and misses the tail
  // (which is where the high-value secret rares live on JP sets).
  const CURSOR_WINDOW = 50;
  const maxPages = options.maxPages ?? SET_GUIDE_MAX_PAGES;
  let cursor = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const url = page === 0 ? baseUrl : `${baseUrl}?cursor=${cursor}`;

    let text: string;
    try {
      // List-path heads prefer direct HTML so a Jina 429 does not stall browse.
      // Full set crawls keep the smaller markdown reader payload.
      text = await fetchPublicPageText(url, 43_200, {
        // Direct HTML is ~200–400ms here; the Jina markdown reader is ~5s and
        // was blowing the Japanese list-price budget, leaving Dex rows on
        // "Price pending" even when the console page had the card.
        readerFirst: false,
        preferHtml: true,
      });
    } catch {
      break;
    }

    const parsed = parseGuidePage(text);
    let added = 0;

    for (const entry of parsed) {
      if (!byProductUrl.has(entry.productUrl)) {
        byProductUrl.set(entry.productUrl, entry);
        added += 1;
      }
    }

    // A short page that adds nothing new means the list is exhausted. A FULL
    // page that adds nothing is just an already-covered window — keep walking,
    // the uncovered tail may start at the next boundary.
    if (parsed.length < SET_GUIDE_FULL_PAGE_ROWS && !added) {
      break;
    }

    cursor = Math.max(
      cursor + CURSOR_WINDOW,
      Math.floor(byProductUrl.size / CURSOR_WINDOW) * CURSOR_WINDOW,
    );
  }

  if (!byProductUrl.size) {
    return null;
  }

  return {
    slug,
    url: baseUrl,
    fetchedAt: nowIso(),
    entries: [...byProductUrl.values()],
  };
}

/** Read a previously cached set guide without crawling PriceCharting. */
export async function peekCachedPriceChartingSetGuide(
  slug: string,
): Promise<PriceChartingSetGuide | null> {
  const cleanSlug = slug.trim().toLowerCase();

  if (!cleanSlug) {
    return null;
  }

  const cached = await readMarketFileCache<PriceChartingSetGuide>(
    "pricecharting-set-guide",
    cleanSlug,
    SET_GUIDE_TTL_MS,
  );

  return cached?.entries?.length ? cached : null;
}

/** Fetch (or read from cache) the full price guide for one set slug. */
export async function fetchPriceChartingSetGuide(
  slug: string,
): Promise<PriceChartingSetGuide | null> {
  const cleanSlug = slug.trim().toLowerCase();

  if (!cleanSlug) {
    return null;
  }

  const cached = await readMarketFileCache<PriceChartingSetGuide>(
    "pricecharting-set-guide",
    cleanSlug,
    SET_GUIDE_TTL_MS,
  );

  if (cached?.entries?.length && !cached.partial) {
    return cached;
  }

  const negativeExpiry = guideNegativeCache.get(cleanSlug);
  if (negativeExpiry !== undefined) {
    if (negativeExpiry > Date.now()) {
      return null;
    }
    guideNegativeCache.delete(cleanSlug);
  }

  // When every transport for PriceCharting is cooling down, fail fast instead
  // of queueing 81 lookups behind a circuit that will reject them all anyway.
  if (
    isPublicPageCircuitOpen("www.pricecharting.com") &&
    isPublicPageCircuitOpen("r.jina.ai")
  ) {
    return null;
  }

  let inFlight = guideInFlight.get(cleanSlug);

  if (!inFlight) {
    inFlight = fetchGuidePages(cleanSlug)
      .then(async (guide) => {
        if (guide?.entries.length) {
          await writeMarketFileCache("pricecharting-set-guide", cleanSlug, {
            ...guide,
            partial: false,
          });
        } else {
          guideNegativeCache.set(cleanSlug, Date.now() + SET_GUIDE_NEGATIVE_TTL_MS);
        }
        return guide;
      })
      .catch(() => {
        guideNegativeCache.set(cleanSlug, Date.now() + SET_GUIDE_NEGATIVE_TTL_MS);
        return null;
      })
      .finally(() => {
        guideInFlight.delete(cleanSlug);
      });
    guideInFlight.set(cleanSlug, inFlight);
  }

  return inFlight;
}

/**
 * First console page only. Enough to price `#001` Dex browse rows without a
 * 10-page crawl, and small vintage sets often fit on that single page.
 */
export async function fetchPriceChartingSetGuideHead(
  slug: string,
): Promise<PriceChartingSetGuide | null> {
  const cleanSlug = slug.trim().toLowerCase();

  if (!cleanSlug) {
    return null;
  }

  const cached = await peekCachedPriceChartingSetGuide(cleanSlug);
  if (cached) {
    return cached;
  }

  const fullInFlight = guideInFlight.get(cleanSlug);
  if (fullInFlight) {
    return fullInFlight;
  }

  if (
    isPublicPageCircuitOpen("www.pricecharting.com") &&
    isPublicPageCircuitOpen("r.jina.ai")
  ) {
    return null;
  }

  let inFlight = headInFlight.get(cleanSlug);

  if (!inFlight) {
    inFlight = fetchGuidePages(cleanSlug, { maxPages: 1, preferDirectHtml: true })
      .then(async (guide) => {
        if (!guide?.entries.length) {
          guideNegativeCache.set(cleanSlug, Date.now() + SET_GUIDE_NEGATIVE_TTL_MS);
          return null;
        }

        const existing = await readMarketFileCache<PriceChartingSetGuide>(
          "pricecharting-set-guide",
          cleanSlug,
          SET_GUIDE_TTL_MS,
        );
        if (existing?.entries?.length && !existing.partial) {
          return existing;
        }

        const payload: PriceChartingSetGuide = {
          ...guide,
          partial: guide.entries.length >= SET_GUIDE_FULL_PAGE_ROWS,
        };
        await writeMarketFileCache("pricecharting-set-guide", cleanSlug, payload);
        return payload;
      })
      .catch(() => {
        guideNegativeCache.set(cleanSlug, Date.now() + SET_GUIDE_NEGATIVE_TTL_MS);
        return null;
      })
      .finally(() => {
        headInFlight.delete(cleanSlug);
      });
    headInFlight.set(cleanSlug, inFlight);
  }

  return inFlight;
}

function nameAgrees(queryEnglishName: string | undefined, entryName: string) {
  if (!queryEnglishName?.trim()) {
    // No English name to compare — the printed collector number is unique per
    // set on PriceCharting, so a number-only match is still the right product.
    return true;
  }

  const queryTokens = normalizeNameText(queryEnglishName).split(" ").filter(Boolean);
  const entryText = normalizeNameText(entryName);

  if (!queryTokens.length || !entryText) {
    return true;
  }

  return queryTokens.some((token) => token.length >= 3 && entryText.includes(token));
}

const GENERIC_JAPANESE_PRODUCT_NAME_TOKENS = new Set([
  "card",
  "cards",
  "japan",
  "japanese",
  "pokemon",
  "tcg",
]);

function strictJapaneseNameTokens(value: string) {
  return normalizeNameText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !GENERIC_JAPANESE_PRODUCT_NAME_TOKENS.has(token));
}

function strictJapaneseNameAgrees(queryEnglishName: string | undefined, entryName: string) {
  if (!queryEnglishName?.trim()) {
    return false;
  }

  const queryTokens = strictJapaneseNameTokens(queryEnglishName);
  const entryTokens = strictJapaneseNameTokens(entryName);

  if (!queryTokens.length || queryTokens.length !== entryTokens.length) {
    return false;
  }

  const entryTokenCounts = new Map<string, number>();
  for (const token of entryTokens) {
    entryTokenCounts.set(token, (entryTokenCounts.get(token) ?? 0) + 1);
  }

  for (const token of queryTokens) {
    const remaining = entryTokenCounts.get(token) ?? 0;
    if (remaining <= 0) {
      return false;
    }
    entryTokenCounts.set(token, remaining - 1);
  }

  return true;
}

function priceChartingProductSetSlug(productUrl: string) {
  try {
    const url = new URL(productUrl);
    if (!/(^|\.)pricecharting\.com$/i.test(url.hostname)) {
      return null;
    }
    return url.pathname.match(/^\/game\/([^/]+)\/[^/]+\/?$/i)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function guideGradedPrices(entry: PriceChartingSetGuideEntry, sourceUrl: string): GradedPrice[] {
  const rows: Array<{ grade: string; service: "RAW" | "PSA"; value: number }> = [
    { grade: "Ungraded", service: "RAW", value: entry.ungradedUsd },
    { grade: "PSA 9", service: "PSA", value: entry.grade9Usd },
    { grade: "PSA 10", service: "PSA", value: entry.psa10Usd },
  ];

  return rows.flatMap((row) =>
    row.value > 0
      ? [
          {
            grade: row.grade,
            value: row.value,
            populationCount: 0,
            source: "PriceCharting set guide",
            saleCount: 0,
            lastSoldAt: null,
            service: row.service,
            confidence: "medium" as const,
            confidenceScore: row.grade === "PSA 10" ? 0.66 : 0.6,
            evidenceType: "guide_snapshot" as const,
            sourceUrl,
          },
        ]
      : [],
  );
}

export type SetGuidePriceQuery = {
  language?: string;
  setCode?: string;
  setName?: string;
  setEnglishName?: string;
  collectorNumber?: string;
  englishName?: string;
  productId?: string;
  productUrl?: string;
  setSlug?: string;
  finish?: CardFinishId | string | null;
};

function guideEntryHaystack(entry: PriceChartingSetGuideEntry) {
  return `${entry.name} ${entry.productUrl}`;
}

export function guideEntryMatchesFinish(
  entry: PriceChartingSetGuideEntry,
  finish?: CardFinishId | string | null,
) {
  const parsed = parseCardFinishId(finish ?? null);
  const haystack = guideEntryHaystack(entry);
  if (!parsed) {
    return !/1st-edition|first-edition|1st edition|first edition|reverse/i.test(haystack);
  }

  return productUrlMatchesFinish(haystack, parsed);
}

function pickGuideEntryForFinish(
  candidates: PriceChartingSetGuideEntry[],
  finish?: CardFinishId | string | null,
) {
  if (!candidates.length) {
    return null;
  }

  const matched = candidates.filter((candidate) => guideEntryMatchesFinish(candidate, finish));
  if (matched.length) {
    return matched[0];
  }

  return parseCardFinishId(finish ?? null) ? null : candidates[0];
}

/**
 * Japanese guide matches are eligible for canonical persistence only when all
 * identity axes agree: native set console, exact printed number, and an exact
 * normalized English market name when one is already known. English lookups
 * retain their existing looser name behavior to avoid changing that pipeline.
 */
export function findPriceChartingSetGuideEntry(
  query: SetGuidePriceQuery,
  guideSlug: string,
  entries: PriceChartingSetGuideEntry[],
) {
  const numbered = entries.filter((candidate) =>
    priceChartingSetGuideEntryMatchesQuery(query, guideSlug, candidate),
  );
  const numberedMatch = pickGuideEntryForFinish(numbered, query.finish);

  if (numberedMatch) {
    return numberedMatch;
  }

  // Vintage Japanese TCGdex localIds are set-order (`neo3-001` = first card,
  // Zubat) while PriceCharting files the print under the Japanese number
  // (`Zubat #41`). A unique exact English name on the native console is the
  // same print — only after the localized name has been resolved.
  if (query.language !== "ja" || !query.englishName?.trim()) {
    return null;
  }

  if (classifyLocalizedPriceChartingSetSlug(query.setCode, guideSlug) !== "native") {
    return null;
  }

  const named = entries.filter(
    (candidate) =>
      priceChartingProductSetSlug(candidate.productUrl) === guideSlug.trim().toLowerCase() &&
      strictJapaneseNameAgrees(query.englishName, candidate.name) &&
      candidate.ungradedUsd > 0 &&
      guideEntryMatchesFinish(candidate, query.finish),
  );

  if (named.length === 1) {
    return named[0];
  }

  if (named.length > 1) {
    const basePrints = named.filter(
      (candidate) => !/\b(holo|reverse|1st|first edition)\b/i.test(candidate.name),
    );
    const pool = basePrints.length ? basePrints : named;
    return pool
      .slice()
      .sort(
        (left, right) =>
          Number.parseInt(left.numberBase, 10) - Number.parseInt(right.numberBase, 10),
      )[0];
  }

  return null;
}

export function priceChartingSetGuideEntryMatchesQuery(
  query: SetGuidePriceQuery,
  guideSlug: string,
  entry: PriceChartingSetGuideEntry,
) {
  const numberBase = normalizeNumberBase(query.collectorNumber ?? "");
  if (!numberBase || entry.numberBase !== numberBase) {
    return false;
  }

  if (query.language !== "ja") {
    return nameAgrees(query.englishName, entry.name);
  }

  if (
    classifyLocalizedPriceChartingSetSlug(query.setCode, guideSlug) !== "native" ||
    priceChartingProductSetSlug(entry.productUrl) !== guideSlug.trim().toLowerCase()
  ) {
    return false;
  }

  // Within a verified native Japanese console the printed number is unique.
  // This number-only case is what lets trainer/energy cards acquire an English
  // market name from the guide; once a name exists, require an exact token set.
  if (!query.englishName?.trim()) {
    return true;
  }

  return strictJapaneseNameAgrees(query.englishName, entry.name);
}

/**
 * Resolve the set's PriceCharting slug candidates and return the first guide
 * that has entries. This is the shared entry point for per-card lookups AND
 * set-browse supplements (missing secret rares).
 */
export async function fetchPriceChartingSetGuideForSet(query: {
  language?: string;
  setCode?: string;
  setName?: string;
  setEnglishName?: string;
  setSlug?: string;
}): Promise<PriceChartingSetGuide | null> {
  const setSeed = query.setEnglishName?.trim() || query.setName?.trim() || "";

  if (!setSeed && !query.setCode?.trim() && !query.setSlug?.trim()) {
    return null;
  }

  const resolvedSlugs = await resolvePriceChartingSetSlugs(setSeed, {
    setCode: query.setCode,
    language: query.language,
  }).catch(() => [] as string[]);
  const slugs = [
    ...new Set([query.setSlug?.trim().toLowerCase(), ...resolvedSlugs].filter(Boolean)),
  ].filter(
    (slug): slug is string =>
      Boolean(slug) &&
      (query.language !== "ja" ||
        classifyLocalizedPriceChartingSetSlug(query.setCode, slug) === "native"),
  );

  for (const slug of slugs.slice(0, 3)) {
    const guide = await fetchPriceChartingSetGuide(slug);

    if (guide?.entries.length) {
      return guide;
    }
  }

  return null;
}

/**
 * Answer a per-card price query from the shared set-level guide. Returns a
 * provider-shaped result on a verified (number + loose name) match, else null
 * so the caller falls through to the per-card pipeline.
 */
export async function lookupPriceChartingSetGuidePrice(
  query: SetGuidePriceQuery,
): Promise<ProviderPriceResult | null> {
  const numberBase = normalizeNumberBase(query.collectorNumber ?? "");

  if (!numberBase) {
    return null;
  }

  const guide = await fetchPriceChartingSetGuideForSet(query);

  if (!guide?.entries.length) {
    return null;
  }

  const entry = findPriceChartingSetGuideEntry(query, guide.slug, guide.entries);

  if (!entry || !(entry.ungradedUsd > 0)) {
    return null;
  }

  return {
    provider: "pricecharting-api",
    sourceLabel: "PriceCharting set guide",
    ungradedUsd: entry.ungradedUsd,
    confidenceScore: 0.62,
    matchConfidence: 0.92,
    evidenceType: "guide_snapshot",
    gradedPrices: guideGradedPrices(entry, entry.productUrl),
    sourceUrl: entry.productUrl,
    productId: entry.productId,
    productName: entry.name,
    productUrl: entry.productUrl,
    setSlug: guide.slug,
    sampleCount: 1,
    fetchedAt: nowIso(),
  };
}

/* ─── Secret-rare supplement cards ────────────────────────────────────────
   The official Pokemon Card catalog only exposes the BASE print run for
   supplement sets, so the SAR/UR slots that the guide knows about are turned
   into browsable cards. Their ids embed set + printed number
   (`official-pc-m5-118` → slug `ja--official-pc-m5-118`) so the card detail
   route can deterministically rebuild the card from the cached guide. */

export type SecretRareSetInfo = {
  setId: string;
  setCode: string;
  setName: string;
  setLocalizedName?: string;
  setEnglishName?: string;
  setPrintedTotal?: number;
  setTotal?: number;
};

export function buildGuideSecretRareCard(
  entry: PriceChartingSetGuideEntry,
  setInfo: SecretRareSetInfo,
  guideUrl: string,
): TcgCard {
  const fetchedAt = nowIso();
  const id = `official-pc-${setInfo.setCode.toLowerCase()}-${entry.numberBase}`;
  const image = entry.imageUrl?.replace(/\/\d+\.jpg(\?.*)?$/i, "/240.jpg") ?? "";
  const gradedPrices: GradedPrice[] = [
    { grade: "Ungraded", value: entry.ungradedUsd, populationCount: 0 },
    ...(entry.psa10Usd > 0
      ? [{ grade: "PSA 10", value: entry.psa10Usd, populationCount: 0 }]
      : []),
  ];

  const priceChartingSetSlug =
    guideUrl.match(/\/console\/([^/?#]+)/i)?.[1] ??
    entry.productUrl.match(/\/game\/([^/?#]+)\//i)?.[1] ??
    null;

  return attachFinishMarketsToCard({
    id,
    slug: buildLocalizedSlug("ja", id),
    language: "ja",
    languageLabel: "Japanese",
    name: entry.name,
    englishName: entry.name,
    collectorNumber: entry.numberBase,
    rarity: "Secret rare",
    supertype: "Pokemon",
    hp: "-",
    types: [],
    setId: setInfo.setId,
    setCode: setInfo.setCode,
    setName: setInfo.setName,
    setLocalizedName: setInfo.setLocalizedName,
    setEnglishName: setInfo.setEnglishName,
    image,
    artist: "Unknown",
    setPrintedTotal: setInfo.setPrintedTotal,
    setTotal: setInfo.setTotal,
    imageStatus: image ? "derived" : "placeholder",
    marketPriceUsd: entry.ungradedUsd,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "PriceCharting set guide",
      fetchedAt: null,
      note: "Secret-rare identity supplemented from PriceCharting's set guide. Population data resolves from public market sources when available.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [{ date: fetchedAt.slice(0, 10), value: entry.ungradedUsd }],
    gradedPrices,
    recentSales: [],
    priceConsensus: {
      finalEstimateUsd: entry.ungradedUsd,
      confidence: "medium",
      confidenceScore: 0.62,
      sourceCount: 1,
      sampleCount: 0,
      methodology:
        "Secret-rare print listed and priced from PriceCharting's set-level public guide snapshot.",
      sources: [
        {
          source: "PriceCharting set guide",
          value: entry.ungradedUsd,
          confidence: "medium",
          confidenceScore: 0.62,
          evidenceType: "guide_snapshot",
          note: "Set-level guide snapshot row for this print.",
        },
      ],
    },
    marketIdentity: {
      officialCardId: id,
      browseIndex: null,
      japaneseName: entry.name,
      englishMarketName: entry.name,
      printedCollectorNumber: entry.numberBase,
      collectorNumberTotal: setInfo.setTotal ?? setInfo.setPrintedTotal ?? null,
      japaneseSetCode: setInfo.setCode,
      japaneseSetName: setInfo.setLocalizedName ?? null,
      englishSetName: setInfo.setEnglishName ?? null,
      priceChartingSetSlug,
      priceChartingProductId: entry.productId ?? null,
      priceChartingProductUrl: entry.productUrl || null,
      identityConfidence: 0.7,
      identitySource: ["pricecharting-discovery"],
      identityStatus: "partial",
      verifiedAt: fetchedAt,
      identityVersion: 1,
    },
    sources: [
      {
        source: "PriceCharting set guide",
        status: "verified",
        fetchedAt,
        confidence: 0.62,
        note: `Listed from the PriceCharting set guide (${guideUrl}); the official Japanese catalog does not expose secret-rare slots for this set.`,
      },
    ],
  });
}

function cardNeedsSetGuideFinishHydration(card: TcgCard) {
  if (!(card.marketPriceUsd > 0)) {
    return true;
  }

  if (isFirstEditionFinish(card.finish) && !(card.marketPriceUsd > 0)) {
    return true;
  }

  return Boolean(
    card.finishMarkets?.some(
      (market) => isFirstEditionFinish(market.id) && !(market.ungradedUsd > 0),
    ),
  );
}

export function mergeSetGuideFinishMarketsIntoCard(
  card: TcgCard,
  guide: PriceChartingSetGuide,
  query: { language?: string; setCode?: string } = {},
): TcgCard {
  const englishName =
    card.englishName?.trim() ||
    inferEnglishNameFromTcgdexLocalizedName(card.localizedName ?? card.name);

  if (
    card.language === "ja" &&
    isTcgdexStyleJapaneseCardId(card.id, card.slug) &&
    !englishName
  ) {
    return card;
  }

  const lookup = {
    language: query.language ?? card.language,
    setCode: query.setCode ?? card.setCode,
    collectorNumber: card.collectorNumber,
    englishName,
  };
  const existing = card.finishMarkets ?? [];
  const withFirstEdition =
    setHasFirstEditionPrints(card) &&
    !existing.some((market) => isFirstEditionFinish(market.id)) &&
    !card.id.endsWith("-1st-edition") &&
    !card.slug.endsWith("-1st-edition")
      ? mergeFinishMarkets(existing, [
          existing.some((market) => market.id === "normal")
            ? "firstEditionNormal"
            : "firstEditionHolofoil",
        ])
      : existing;
  const nextMarkets = withFirstEdition.map((market) => {
    const entry = findPriceChartingSetGuideEntry(
      { ...lookup, finish: market.id },
      guide.slug,
      guide.entries,
    );
    if (!entry || !(entry.ungradedUsd > 0)) {
      return market;
    }
    if (market.ungradedUsd > 0 && market.ungradedUsd >= entry.ungradedUsd) {
      return market;
    }
    return { ...market, ungradedUsd: entry.ungradedUsd };
  });
  const selected =
    nextMarkets.find((market) => market.id === card.finish) ??
    nextMarkets.find((market) => market.ungradedUsd > 0);
  const headlineEntry = findPriceChartingSetGuideEntry(
    { ...lookup, finish: card.finish },
    guide.slug,
    guide.entries,
  );
  const headlineUsd =
    selected && selected.ungradedUsd > 0
      ? selected.ungradedUsd
      : headlineEntry?.ungradedUsd && headlineEntry.ungradedUsd > 0
        ? headlineEntry.ungradedUsd
        : 0;

  if (!(headlineUsd > 0) && nextMarkets.every((market, index) => market === withFirstEdition[index])) {
    return card;
  }

  if (
    card.marketPriceUsd > 0 &&
    card.marketPriceUsd >= headlineUsd &&
    !isSuspiciouslyLowCatalogPrice(card) &&
    nextMarkets.every((market, index) => market.ungradedUsd === (withFirstEdition[index]?.ungradedUsd ?? 0))
  ) {
    return card;
  }

  const appliedEntry =
    headlineEntry && headlineEntry.ungradedUsd === headlineUsd
      ? headlineEntry
      : findPriceChartingSetGuideEntry(lookup, guide.slug, guide.entries);
  const nextEnglishName = card.englishName?.trim() || appliedEntry?.name || englishName;
  const localizedName = card.localizedName ?? card.name;
  const fetchedAt = nowIso();

  return {
    ...card,
    englishName: nextEnglishName,
    name:
      card.language === "ja"
        ? formatBilingualName(localizedName, nextEnglishName)
        : card.name,
    finishMarkets: nextMarkets.length ? nextMarkets : card.finishMarkets,
    marketPriceUsd: headlineUsd > 0 ? headlineUsd : card.marketPriceUsd,
    gradedPrices: appliedEntry
      ? mergeGuideGradedPrices(card.gradedPrices, appliedEntry, appliedEntry.productUrl || guide.url)
      : card.gradedPrices.map((price) =>
          price.grade === "Ungraded" && headlineUsd > 0 ? { ...price, value: headlineUsd } : price,
        ),
    priceHistory: card.priceHistory.map((point) => ({
      ...point,
      value: headlineUsd > 0 ? headlineUsd : point.value,
    })),
    priceConsensus: headlineUsd > 0
      ? {
          finalEstimateUsd: headlineUsd,
          confidence: "medium",
          confidenceScore: 0.62,
          sourceCount: 1,
          sampleCount: 0,
          methodology:
            "Set browse price from PriceCharting's public set-level guide snapshot.",
          sources: [
            {
              source: "PriceCharting set guide",
              value: headlineUsd,
              confidence: "medium",
              confidenceScore: 0.62,
              evidenceType: "guide_snapshot",
              note: "Applied from the shared set guide instead of a per-card scrape.",
            },
          ],
        }
      : card.priceConsensus,
    sources:
      headlineUsd > 0
        ? [
            {
              source: "PriceCharting set guide",
              status: "verified" as const,
              fetchedAt,
              confidence: 0.62,
              note: "Set browse price from the shared PriceCharting console snapshot.",
            },
            ...card.sources.filter((source) => source.source !== "PriceCharting set guide"),
          ]
        : card.sources,
  };
}

/**
 * Stamp every matching print with the shared set-level guide in one pass.
 * Set browse used to race 24 per-card resolvePrice calls (8s each) after this
 * snapshot was already in memory, which blew past a 15s page budget.
 */
export function applyPriceChartingSetGuideToCards(
  cards: TcgCard[],
  guide: PriceChartingSetGuide,
  query: { language?: string; setCode?: string } = {},
): TcgCard[] {
  if (!guide.entries.length) {
    return cards;
  }

  return cards.map((card) => mergeSetGuideFinishMarketsIntoCard(card, guide, query));
}

const SET_GUIDE_HYDRATE_CONCURRENCY = 4;

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>,
) {
  if (!items.length) {
    return;
  }

  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await mapper(items[currentIndex]);
      }
    }),
  );
}

export async function hydrateCardsFromPriceChartingSetGuides(
  cards: TcgCard[],
  options: { budgetMs?: number } = {},
): Promise<TcgCard[]> {
  const budgetMs = options.budgetMs ?? 1_500;
  if (!cards.length) {
    return cards;
  }

  const groups = new Map<string, TcgCard[]>();
  for (const card of cards) {
    const key = [
      card.language,
      (card.setCode || card.setId || card.setEnglishName || card.setName || "").toLowerCase(),
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(card);
    groups.set(key, group);
  }

  const byId = new Map<string, TcgCard>();
  const startedAt = Date.now();
  const pending: TcgCard[][] = [];

  for (const group of groups.values()) {
    if (!group.some(cardNeedsSetGuideFinishHydration)) {
      for (const card of group) {
        byId.set(card.id, card);
      }
      continue;
    }

    pending.push(group);
  }

  pending.sort((left, right) => {
    const leftFirst = left.some((card) =>
      card.finishMarkets?.some((market) => isFirstEditionFinish(market.id)),
    );
    const rightFirst = right.some((card) =>
      card.finishMarkets?.some((market) => isFirstEditionFinish(market.id)),
    );
    return Number(rightFirst) - Number(leftFirst);
  });

  await mapWithConcurrency(pending, SET_GUIDE_HYDRATE_CONCURRENCY, async (group) => {
    if (Date.now() - startedAt > budgetMs) {
      for (const card of group) {
        byId.set(card.id, card);
      }
      return;
    }

    const sample = group[0];
    const remaining = Math.max(200, budgetMs - (Date.now() - startedAt));
    const guide = await Promise.race([
      fetchPriceChartingSetGuideForSet({
        language: sample.language,
        setCode: sample.setCode,
        setName: sample.setEnglishName || sample.setName,
        setEnglishName: sample.setEnglishName,
      }).catch(() => null),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), remaining);
      }),
    ]);

    const next = guide?.entries.length
      ? applyPriceChartingSetGuideToCards(group, guide, {
          language: sample.language,
          setCode: sample.setCode,
        })
      : group;
    for (const card of next) {
      byId.set(card.id, card);
    }
  });

  return cards.map((card) => byId.get(card.id) ?? card);
}

function mergeGuideGradedPrices(
  existing: TcgCard["gradedPrices"],
  entry: PriceChartingSetGuideEntry,
  sourceUrl: string,
) {
  const fromGuide = guideGradedPrices(entry, sourceUrl);
  const byGrade = new Map(existing.map((price) => [price.grade, price]));

  for (const price of fromGuide) {
    const current = byGrade.get(price.grade);
    if (!current || !(current.value > 0) || current.value < price.value) {
      byGrade.set(price.grade, price);
    }
  }

  return [...byGrade.values()];
}

const SECRET_RARE_SLUG_PATTERN = /^ja--official-pc-([a-z0-9]+)-(\d+)$/;

/**
 * Rebuild a secret-rare supplement card from its deterministic slug
 * (`ja--official-pc-m5-118`). Returns null for any other slug shape, so the
 * card-detail pipeline can use this as a cheap early branch. Without it, the
 * generic official-catalog lookup treats `pc-m5-118` as a pokemon-card.com id
 * and answers with a junk record (empty image/number) that broke the detail
 * page's <Image> rendering.
 */
export async function resolveGuideSecretRareCardBySlug(
  slug: string,
): Promise<TcgCard | null> {
  const match = slug.trim().toLowerCase().match(SECRET_RARE_SLUG_PATTERN);

  if (!match) {
    return null;
  }

  const setCode = normalizeSetCode(match[1].toUpperCase());
  const numberBase = match[2].replace(/^0+(?=\d)/, "");
  const profile = getLocalizedSetMarketProfile(setCode);
  const guide = await fetchPriceChartingSetGuideForSet({
    language: "ja",
    setCode,
    setName: profile?.englishName ?? setCode,
    setEnglishName: profile?.englishName,
  });
  const entry = guide?.entries.find((candidate) => candidate.numberBase === numberBase);

  if (!entry) {
    return null;
  }

  const supplementSet = getOfficialJapaneseSetSupplementById(setCode);
  const setEnglishName = profile?.englishName ?? setCode;

  return buildGuideSecretRareCard(
    entry,
    {
      setId: setCode,
      setCode,
      setName: setEnglishName,
      setLocalizedName: supplementSet?.localizedName ?? undefined,
      setEnglishName,
      setPrintedTotal: supplementSet?.printedTotal ?? supplementSet?.total,
      setTotal: supplementSet?.total ?? supplementSet?.printedTotal,
    },
    guide?.url ?? "https://www.pricecharting.com",
  );
}
