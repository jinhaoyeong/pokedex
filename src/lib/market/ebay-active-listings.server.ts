import "server-only";

import type { ActiveListing, CardFinishId } from "@/types/pokemon";

import {
  isAcceptedActiveListing,
  type ActiveListingGradeFilter,
  type ActiveListingQuery,
} from "@/lib/market/active-listing-hygiene";
import { estimatedGradeValuesEnabled } from "@/lib/market/estimated-grade-values";
import { isEbayConfigured, searchEbayBrowseListings } from "@/lib/price/providers/ebay";
import { nowIso } from "@/lib/price/providers/shared";

const CACHE_TTL_MS = 15 * 60 * 1000;

type CachedBrowse = {
  expiresAt: number;
  listings: ActiveListing[];
  discardedCount: number;
};

const browseCache = new Map<string, CachedBrowse>();

export type EbayActiveLookupQuery = {
  name: string;
  englishName?: string;
  setName?: string;
  setEnglishName?: string;
  collectorNumber?: string;
  language?: string;
  finish?: CardFinishId | string | null;
  rarity?: string | null;
};

function cacheKey(query: EbayActiveLookupQuery, grade: ActiveListingGradeFilter) {
  return [
    grade,
    query.language ?? "en",
    query.setEnglishName ?? query.setName ?? "",
    query.englishName ?? query.name,
    query.collectorNumber ?? "",
    query.finish ?? "",
  ]
    .join("|")
    .toLowerCase();
}

function buildSearchText(query: EbayActiveLookupQuery, grade: ActiveListingGradeFilter) {
  const name = query.englishName?.trim() || query.name.trim();
  const setName = query.setEnglishName?.trim() || query.setName?.trim() || "";
  const number = query.collectorNumber?.trim() ?? "";
  const language = query.language && query.language !== "en" ? "japanese" : "";
  const gradeToken = grade === "Ungraded" ? "ungraded raw" : grade;
  return [name, setName, number, language, gradeToken, "pokemon"].filter(Boolean).join(" ");
}

function toMatchQuery(
  query: EbayActiveLookupQuery,
  grade: ActiveListingGradeFilter,
): ActiveListingQuery {
  return {
    name: query.name,
    englishName: query.englishName,
    collectorNumber: query.collectorNumber,
    setName: query.setName,
    setEnglishName: query.setEnglishName,
    language: query.language,
    finish: query.finish,
    rarity: query.rarity,
    requestedGrade: grade,
  };
}

async function lookupGrade(
  query: EbayActiveLookupQuery,
  grade: ActiveListingGradeFilter,
  signal?: AbortSignal,
): Promise<{ listings: ActiveListing[]; discardedCount: number }> {
  const key = cacheKey(query, grade);
  const cached = browseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { listings: cached.listings, discardedCount: cached.discardedCount };
  }

  const items = await searchEbayBrowseListings(buildSearchText(query, grade), signal);
  const match = toMatchQuery(query, grade);
  const fetchedAt = nowIso();
  const listings: ActiveListing[] = [];
  let discardedCount = 0;

  for (const item of items) {
    if (!isAcceptedActiveListing(item.title, match)) {
      discardedCount += 1;
      continue;
    }
    listings.push({
      title: item.title,
      priceUsd: item.priceUsd,
      grade,
      source: "eBay",
      listingUrl: item.listingUrl,
      fetchedAt,
      condition: grade,
    });
  }

  const value = { listings, discardedCount, expiresAt: Date.now() + CACHE_TTL_MS };
  browseCache.set(key, value);
  return value;
}

export async function lookupEbayActiveListings(
  query: EbayActiveLookupQuery,
  signal?: AbortSignal,
): Promise<{
  listings: ActiveListing[];
  discardedCount: number;
  asksByGrade: Record<ActiveListingGradeFilter, number[]>;
}> {
  const empty = {
    listings: [] as ActiveListing[],
    discardedCount: 0,
    asksByGrade: {
      Ungraded: [] as number[],
      "PSA 9": [] as number[],
      "PSA 10": [] as number[],
    },
  };

  if (!estimatedGradeValuesEnabled() || !isEbayConfigured()) {
    return empty;
  }

  const grades: ActiveListingGradeFilter[] = ["Ungraded", "PSA 9", "PSA 10"];
  const results = await Promise.all(grades.map((grade) => lookupGrade(query, grade, signal)));
  const listings = results.flatMap((result) => result.listings);
  const discardedCount = results.reduce((sum, result) => sum + result.discardedCount, 0);
  const asksByGrade = empty.asksByGrade;
  for (const listing of listings) {
    const grade = listing.grade as ActiveListingGradeFilter;
    if (grade in asksByGrade) {
      asksByGrade[grade].push(listing.priceUsd);
    }
  }

  return { listings, discardedCount, asksByGrade };
}
