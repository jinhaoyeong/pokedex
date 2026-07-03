import { NextResponse } from "next/server";

import { fetchQuickLocalizedGuidePrice } from "@/lib/grading-market";
import {
  findOfficialJapaneseBrowseSeedByCardId,
  findOfficialJapaneseBrowseSeedBySetIndex,
  type OfficialJapaneseBrowseSeedMatch,
} from "@/lib/official-japanese-browse.server";
import {
  buildOfficialJapaneseDetailFromBrowseItem,
  fetchOfficialJapaneseCardDetail,
  resolveOfficialJapaneseEnglishName,
} from "@/lib/pokemon-tcg/official-japanese-catalog";
import { resolvePrice } from "@/lib/price/resolve.server";
import type { PriceQuery, ResolvedPrice } from "@/lib/price/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeProviderCardId(cardId?: string) {
  const clean = cardId?.trim();

  if (!clean) {
    return undefined;
  }

  if (clean.startsWith("official-")) {
    const officialId = clean.replace(/^official-/, "");
    return /^\d+$/.test(officialId) ? undefined : officialId;
  }

  return clean;
}

function extractParentheticalEnglish(value?: string | null) {
  const match = value?.match(/\(([^()]*[A-Za-z][^()]*)\)\s*$/);
  return match?.[1]?.trim() || undefined;
}

function extractOfficialJapaneseId(value?: string | null) {
  const clean = value?.trim();

  if (!clean) {
    return undefined;
  }

  const slugMatch = clean.match(/^ja--official-(\d+)$/i);

  if (slugMatch?.[1]) {
    return slugMatch[1];
  }

  const cardIdMatch = clean.match(/^official-(\d+)$/i);

  if (cardIdMatch?.[1]) {
    return cardIdMatch[1];
  }

  return undefined;
}

async function hydrateOfficialJapanesePriceQuery(
  query: PriceQuery,
  raw: { cardId?: string | null; number?: string | null },
): Promise<PriceQuery> {
  if (query.language !== "ja") {
    return query;
  }

  const officialId =
    extractOfficialJapaneseId(raw.cardId) ?? extractOfficialJapaneseId(query.slug);
  let seedMatch: OfficialJapaneseBrowseSeedMatch | null = officialId
    ? findOfficialJapaneseBrowseSeedByCardId(officialId)
    : null;

  // Search-list fallbacks can pass `official-173`/`number=173`, where 173 is
  // the browse index, not the printed collector number. Resolve that index to
  // the real official cardID before constructing PriceCharting queries.
  if (!seedMatch) {
    seedMatch = findOfficialJapaneseBrowseSeedBySetIndex(query.setCode, raw.number ?? undefined);
  }

  if (!seedMatch) {
    return query;
  }

  const browseDetail = buildOfficialJapaneseDetailFromBrowseItem(
    seedMatch.item,
    seedMatch.setIndex,
    seedMatch.setCode,
    seedMatch.hitCnt,
  );
  const officialDetail =
    (await fetchOfficialJapaneseCardDetail(seedMatch.item.cardID, seedMatch.item).catch(() => null)) ??
    browseDetail;
  const collectorNumber =
    officialDetail.collectorNumber?.trim() || browseDetail.collectorNumber?.trim();
  const englishName =
    query.englishName?.trim() ||
    resolveOfficialJapaneseEnglishName(officialDetail) ||
    extractParentheticalEnglish(query.name);

  return {
    ...query,
    cardId: undefined,
    collectorNumber: collectorNumber || query.collectorNumber,
    englishName,
    setCode: officialDetail.setCode?.trim() || browseDetail.setCode || query.setCode,
  };
}

async function applyJapaneseGuideFallback(
  query: PriceQuery,
  resolved: ResolvedPrice,
): Promise<ResolvedPrice> {
  if (resolved.ungradedUsd > 0 || query.language !== "ja") {
    return resolved;
  }

  const guide = await fetchQuickLocalizedGuidePrice(
    query.setEnglishName?.trim() || query.setName?.trim() || query.setCode?.trim() || "",
    query.englishName?.trim() || query.name,
    query.collectorNumber ?? "",
    undefined,
    {
      setCode: query.setCode,
      isJapanese: true,
      language: query.language,
      englishCardName: query.englishName?.trim() || undefined,
    },
  ).catch(() => null);

  if (!guide?.ungradedUsd) {
    return resolved;
  }

  return {
    ...resolved,
    ungradedUsd: guide.ungradedUsd,
    confidenceScore: 0.62,
    primaryProvider: "pricecharting-api",
    results: [
      ...resolved.results,
      {
        provider: "pricecharting-api",
        sourceLabel: "PriceCharting public guide",
        ungradedUsd: guide.ungradedUsd,
        confidenceScore: 0.62,
        matchConfidence: 0.9,
        evidenceType: "guide_snapshot",
        gradedPrices: guide.gradedPrices,
        sampleCount: 1,
        fetchedAt: new Date().toISOString(),
      },
    ],
  };
}

/**
 * The UI's price hooks read the headline through several historical aliases
 * (`ungradedUsd`, `marketPrice`, `prices.market` — see getPriceLookupUsd in
 * price-query.ts). Answer with ALL of them so no consumer is ever stuck on
 * "Price Pending" because it reads a key this route didn't populate.
 */
function withFrontendAliases(priced: ResolvedPrice) {
  const market = priced.ungradedUsd > 0 ? priced.ungradedUsd : null;
  const psa10 =
    priced.results
      .flatMap((result) => result.gradedPrices ?? [])
      .find((graded) => /psa\s*10/i.test(graded.grade))?.value ?? null;

  return {
    ...priced,
    marketPrice: market,
    psa10,
    prices: { market, ungraded: market, raw: market, psa10 },
  };
}

/**
 * Block-resistant price lookup. Reads the local price cache first and, on a miss,
 * queries only the NON-BLOCKING API providers (never a scrape). Safe to call from
 * the list/detail UI without ever triggering an IP block.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug")?.trim();
  const name = params.get("name")?.trim();

  if (!slug || !name) {
    return NextResponse.json({ error: "slug and name are required" }, { status: 400 });
  }

  const rawCardId = params.get("cardId");
  const rawNumber = params.get("number");
  const query: PriceQuery = {
    slug,
    name,
    language: params.get("language")?.trim() || "en",
    cardId: normalizeProviderCardId(rawCardId ?? undefined),
    setCode: params.get("setCode")?.trim() || undefined,
    setName: params.get("setName")?.trim() || undefined,
    setEnglishName: params.get("setEnglishName")?.trim() || undefined,
    collectorNumber: rawNumber?.trim() || undefined,
    englishName:
      params.get("englishName")?.trim() ||
      extractParentheticalEnglish(name) ||
      undefined,
    rarity: params.get("rarity")?.trim() || undefined,
  };

  query.setEnglishName ||= extractParentheticalEnglish(query.setName);
  const resolvedQuery = await hydrateOfficialJapanesePriceQuery(query, {
    cardId: rawCardId,
    number: rawNumber,
  });
  resolvedQuery.setEnglishName ||= extractParentheticalEnglish(resolvedQuery.setName);

  // The background warmer forces a fresh, scrape-allowed resolve via an internal
  // token. Public callers always get the fast cache-first, non-blocking path.
  const internalToken = process.env.INTERNAL_REFRESH_TOKEN;
  const isWarm =
    params.get("refresh") === "1" &&
    Boolean(internalToken) &&
    request.headers.get("x-internal-token") === internalToken;

  try {
    const resolved = await resolvePrice(
      resolvedQuery,
      isWarm ? { refresh: true, ttlMs: 0, allowScrape: true } : {},
    );
    const priced = await applyJapaneseGuideFallback(resolvedQuery, resolved);

    return NextResponse.json(withFrontendAliases(priced), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("price lookup failed", { slug, error });
    return NextResponse.json(
      withFrontendAliases({
        slug,
        ungradedUsd: 0,
        confidenceScore: 0,
        primaryProvider: "",
        results: [],
        fetchedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
