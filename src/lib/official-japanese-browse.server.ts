import "server-only";

import bundledBrowseSeed from "../../data/official-japanese-browse-seed.json";

import { buildOfficialJapaneseBrowseSetCodeCandidates } from "@/lib/official-japanese-sets.server";
import type { TcgdexCardBrief, TcgdexSetResponse } from "@/lib/pokemon-tcg/api-types";
import {
  normalizeTcgdexImageUrl,
  TCGDEX_API_BASE_URL,
} from "@/lib/pokemon-tcg/tcgdex-normalizers";
import { resolveLocalizedSetFilterId } from "@/lib/pokemon-tcg/text-and-collector-utils";

export type OfficialJapaneseBrowseItem = {
  cardID: string;
  cardThumbFile: string;
  cardNameAltText: string;
  cardNameViewText: string;
};

type BrowseSeedSet = {
  hitCnt: number;
  cardList: OfficialJapaneseBrowseItem[];
};

type BrowseSeedFile = {
  version: number;
  sets: Record<string, BrowseSeedSet>;
};

type PokemonCardJpSearchResponse = {
  result: number;
  hitCnt: number;
  thisPage: number;
  maxPage: number;
  cardList: OfficialJapaneseBrowseItem[];
};

export type OfficialJapaneseBrowseSeedMatch = {
  item: OfficialJapaneseBrowseItem;
  setCode: string;
  setIndex: number;
  hitCnt: number;
};

const POKEMON_CARD_JP_BASE_URL = "https://www.pokemon-card.com";
const OFFICIAL_JP_BROWSE_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.5",
  Connection: "keep-alive",
  Referer: "https://www.pokemon-card.com/",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const browseSeed = bundledBrowseSeed as BrowseSeedFile;
const COMMUNITY_BROWSE_PAGE_SIZE = 39;
const COMMUNITY_BROWSE_REVALIDATE_SECONDS = 6 * 60 * 60;
const COMMUNITY_BROWSE_TIMEOUT_MS = 3_000;

function normalizeBrowseSeedKey(setCode: string) {
  const trimmed = setCode.trim();
  const upper = trimmed.toUpperCase();

  if (browseSeed.sets[upper]) {
    return upper;
  }

  if (browseSeed.sets[trimmed]) {
    return trimmed;
  }

  const caseInsensitive = Object.keys(browseSeed.sets).find(
    (key) => key.toUpperCase() === upper,
  );

  return caseInsensitive ?? null;
}

function paginateBrowseSeed(set: BrowseSeedSet, page: number): PokemonCardJpSearchResponse | null {
  const cardList = set.cardList ?? [];

  if (!cardList.length) {
    return null;
  }

  const maxPage = Math.max(1, Math.ceil(cardList.length / COMMUNITY_BROWSE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), maxPage);
  const start = (safePage - 1) * COMMUNITY_BROWSE_PAGE_SIZE;

  return {
    result: 1,
    hitCnt: set.hitCnt ?? cardList.length,
    thisPage: safePage,
    maxPage,
    cardList: cardList.slice(start, start + COMMUNITY_BROWSE_PAGE_SIZE),
  };
}

function getOfficialJapaneseBrowseSeedPage(
  setCode: string,
  page: number,
): PokemonCardJpSearchResponse | null {
  const key = normalizeBrowseSeedKey(setCode);

  if (!key) {
    return null;
  }

  return paginateBrowseSeed(browseSeed.sets[key], page);
}

export function findOfficialJapaneseBrowseSeedByCardId(
  cardId: string,
): OfficialJapaneseBrowseSeedMatch | null {
  const cleanCardId = cardId.trim();

  if (!cleanCardId) {
    return null;
  }

  for (const [setCode, set] of Object.entries(browseSeed.sets)) {
    const cardList = set.cardList ?? [];
    const setIndex = cardList.findIndex((item) => item.cardID === cleanCardId);

    if (setIndex !== -1) {
      return {
        item: cardList[setIndex],
        setCode,
        setIndex,
        hitCnt: set.hitCnt ?? cardList.length,
      };
    }
  }

  return null;
}

/**
 * Resolve a pokemon-card.com artwork URL from the bundled official browse seed.
 * Used when TCGdex omits JA scans (common for SM-era sets) and the derived
 * assets.tcgdex.net guess 404s in the browser.
 */
export function resolveOfficialJapaneseBrowseImageUrl(options: {
  setCode?: string | null;
  name?: string | null;
  collectorNumber?: string | null;
  preferSecretRare?: boolean;
}): string | null {
  const setKey = options.setCode ? normalizeBrowseSeedKey(options.setCode) : null;
  if (!setKey) return null;

  const set = browseSeed.sets[setKey];
  const cardList = set?.cardList ?? [];
  if (!cardList.length) return null;

  const nameQuery = normalizeBrowseSeedSearchText(options.name ?? "");
  if (!nameQuery || nameQuery.length < 2) return null;

  const matches = cardList.filter((item) => {
    const alt = normalizeBrowseSeedSearchText(item.cardNameAltText ?? "");
    const view = normalizeBrowseSeedSearchText(item.cardNameViewText ?? "");
    return alt === nameQuery || view === nameQuery || alt.includes(nameQuery) || view.includes(nameQuery);
  });

  if (!matches.length) return null;

  let chosen = matches[0];
  if (matches.length > 1) {
    const sorted = [...matches].sort(
      (left, right) => Number(left.cardID) - Number(right.cardID),
    );
    // Secret/CHR slots are usually the later official card IDs in the same set.
    const collector = Number.parseInt(
      String(options.collectorNumber ?? "").replace(/\D/g, ""),
      10,
    );
    const preferHigh =
      options.preferSecretRare ||
      (Number.isFinite(collector) && collector >= 50);
    chosen = preferHigh ? sorted[sorted.length - 1] : sorted[0];
  }

  const thumb = chosen.cardThumbFile?.trim();
  if (!thumb) return null;
  if (/^https?:\/\//i.test(thumb)) return thumb;
  if (thumb.startsWith("/")) return `${POKEMON_CARD_JP_BASE_URL}${thumb}`;
  return `${POKEMON_CARD_JP_BASE_URL}/${thumb.replace(/^\/+/, "")}`;
}

export function findOfficialJapaneseBrowseSeedBySetIndex(
  setCode: string | undefined,
  indexOrNumber: string | undefined,
): OfficialJapaneseBrowseSeedMatch | null {
  const normalizedSetCode = setCode ? normalizeBrowseSeedKey(setCode) : null;
  const parsedIndex = Number.parseInt(indexOrNumber?.replace(/\D/g, "") ?? "", 10);

  if (!normalizedSetCode || !Number.isFinite(parsedIndex) || parsedIndex <= 0) {
    return null;
  }

  const set = browseSeed.sets[normalizedSetCode];
  const cardList = set?.cardList ?? [];
  const setIndex = parsedIndex - 1;
  const item = cardList[setIndex];

  if (!item) {
    return null;
  }

  return {
    item,
    setCode: normalizedSetCode,
    setIndex,
    hitCnt: set.hitCnt ?? cardList.length,
  };
}

function normalizeBrowseSeedSearchText(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreBrowseSeedItem(item: OfficialJapaneseBrowseItem, aliases: string[]) {
  const names = [item.cardNameAltText, item.cardNameViewText].map(normalizeBrowseSeedSearchText);
  const haystack = normalizeBrowseSeedSearchText(names.join(" "));
  let score = 0;

  for (const alias of aliases) {
    const needle = normalizeBrowseSeedSearchText(alias);

    if (needle.length < 2) {
      continue;
    }

    for (const name of names) {
      if (name === needle) {
        score = Math.max(score, 400);
      } else if (name.startsWith(needle)) {
        score = Math.max(score, 300);
      } else if (name.includes(needle)) {
        score = Math.max(score, 200);
      }
    }

    if (!score && haystack.includes(needle)) {
      score = Math.max(score, 100);
    }
  }

  return score;
}

function uniqueValues(values: string[]) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, items) => items.findIndex(
      (candidate) => candidate.toLowerCase() === value.toLowerCase(),
    ) === index);
}

function priceChartingJapaneseSetCode(setCode: string) {
  return setCode.trim().toUpperCase() === "SV2A" ? "SV2a" : setCode.trim().toUpperCase();
}

export function buildOfficialJapaneseFastPriceCacheKeys(input: {
  slug?: string;
  cardId?: string;
  setCode?: string;
  collectorNumber?: string;
}) {
  const setCode = input.setCode ? priceChartingJapaneseSetCode(input.setCode) : "";
  const numberBase = input.collectorNumber?.trim().split("/")[0]?.replace(/^0+(?=\d)/, "") ?? "";
  const paddedNumber = numberBase ? numberBase.padStart(3, "0") : "";

  return uniqueValues([
    input.slug ?? "",
    input.cardId ?? "",
    setCode && numberBase ? `ja--${setCode}-${numberBase}` : "",
    setCode && paddedNumber ? `ja--${setCode}-${paddedNumber}` : "",
    setCode && numberBase ? `${setCode}-${numberBase}` : "",
    setCode && paddedNumber ? `${setCode}-${paddedNumber}` : "",
    setCode && numberBase ? `${setCode} ${numberBase} Japanese` : "",
    setCode && paddedNumber ? `${setCode} ${paddedNumber} Japanese` : "",
  ]);
}

function buildCommunitySetIdCandidates(setCode: string) {
  const localized = resolveLocalizedSetFilterId("ja", setCode);

  return uniqueValues([
    localized,
    setCode,
    setCode.toUpperCase(),
    setCode.toLowerCase(),
  ]);
}

function mapTcgdexCardToBrowseItem(card: TcgdexCardBrief): OfficialJapaneseBrowseItem | null {
  const cardId = card.id?.trim();
  const localId = card.localId?.trim();
  const name = card.name?.trim();

  if (!cardId || !localId || !name) {
    return null;
  }

  return {
    cardID: cardId,
    cardThumbFile: normalizeTcgdexImageUrl(card.image) ?? "",
    cardNameAltText: name,
    cardNameViewText: name,
  };
}

function mapTcgdexSetToBrowseResponse(
  payload: TcgdexSetResponse,
  page: number,
): PokemonCardJpSearchResponse | null {
  const cards = (payload.cards ?? [])
    .map(mapTcgdexCardToBrowseItem)
    .filter((card): card is OfficialJapaneseBrowseItem => Boolean(card));

  if (!cards.length) {
    return null;
  }

  const officialTotal = payload.cardCount?.official;
  const total = payload.cardCount?.total;
  const hitCnt = Math.max(
    cards.length,
    typeof officialTotal === "number" && officialTotal > 0 ? officialTotal : 0,
    typeof total === "number" && total > 0 ? total : 0,
  );
  const maxPage = Math.max(1, Math.ceil(cards.length / COMMUNITY_BROWSE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), maxPage);
  const start = (safePage - 1) * COMMUNITY_BROWSE_PAGE_SIZE;

  return {
    result: 1,
    hitCnt,
    thisPage: safePage,
    maxPage,
    cardList: cards.slice(start, start + COMMUNITY_BROWSE_PAGE_SIZE),
  };
}

async function fetchCommunitySetJson(candidate: string) {
  const response = await fetch(
    `${TCGDEX_API_BASE_URL}/ja/sets/${encodeURIComponent(candidate)}`,
    {
      headers: { Accept: "application/json" },
      next: { revalidate: COMMUNITY_BROWSE_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(COMMUNITY_BROWSE_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(`TCGdex community set fetch failed: ${response.status}`);
  }

  return (await response.json()) as TcgdexSetResponse;
}

async function fetchCommunityJapaneseBrowsePage(
  setCode: string,
  page: number,
): Promise<PokemonCardJpSearchResponse | null> {
  let lastError: unknown;

  for (const candidate of buildCommunitySetIdCandidates(setCode)) {
    try {
      const payload = await fetchCommunitySetJson(candidate);
      const mapped = mapTcgdexSetToBrowseResponse(payload, page);

      if (mapped?.cardList?.length) {
        return mapped;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.error("community Japanese catalog fallback failed", {
      setCode,
      page,
      error: lastError instanceof Error ? lastError.message : lastError,
    });
  }

  return null;
}

function shouldSkipOfficialLiveBrowse() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

export function searchOfficialJapaneseBrowseSeed({
  aliases,
  page,
  pageSize,
}: {
  aliases: string[];
  page: number;
  pageSize: number;
}): { matches: OfficialJapaneseBrowseSeedMatch[]; totalCount: number } {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 50;
  const usableAliases = aliases.map((alias) => alias.trim()).filter(Boolean);

  if (!usableAliases.length) {
    return { matches: [], totalCount: 0 };
  }

  const scoredMatches: Array<OfficialJapaneseBrowseSeedMatch & { score: number }> = [];
  const seenCardIds = new Set<string>();

  for (const [setCode, set] of Object.entries(browseSeed.sets)) {
    const cardList = set.cardList ?? [];

    for (const [setIndex, item] of cardList.entries()) {
      if (seenCardIds.has(item.cardID)) {
        continue;
      }

      const score = scoreBrowseSeedItem(item, usableAliases);

      if (!score) {
        continue;
      }

      seenCardIds.add(item.cardID);
      scoredMatches.push({
        item,
        setCode,
        setIndex,
        hitCnt: set.hitCnt ?? cardList.length,
        score,
      });
    }
  }

  scoredMatches.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }

    const leftId = Number.parseInt(left.item.cardID, 10);
    const rightId = Number.parseInt(right.item.cardID, 10);

    if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
      return rightId - leftId;
    }

    return left.setCode.localeCompare(right.setCode);
  });

  const start = (normalizedPage - 1) * normalizedPageSize;

  return {
    matches: scoredMatches.slice(start, start + normalizedPageSize),
    totalCount: scoredMatches.length,
  };
}

async function fetchLiveOfficialJapaneseBrowsePage(
  setCode: string,
  page: number,
): Promise<PokemonCardJpSearchResponse | null> {
  const params = new URLSearchParams({
    keyword: "",
    regulation_sidebar_form: "all",
    pg: setCode,
    illust: "",
    sm_and_keyword: "true",
    page: String(page),
  });

  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(
        `${POKEMON_CARD_JP_BASE_URL}/card-search/resultAPI.php?${params.toString()}`,
        {
          headers: OFFICIAL_JP_BROWSE_HEADERS,
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        },
      );

      if (!response.ok) {
        console.error("JAPANESE SCRAPER FAILED | Status:", response.status, response.statusText);

        try {
          const text = await response.text();
          console.error("BODY RESPONSE:", text.substring(0, 200));
        } catch (error) {
          console.error("BODY RESPONSE: <failed to read>", error);
        }

        console.error("official Japanese browse API returned non-200", {
          setCode,
          page,
          attempt,
          status: response.status,
          statusText: response.statusText,
        });

        if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }

        return null;
      }

      const payload = (await response.json()) as PokemonCardJpSearchResponse;

      if (payload.result === 1 && payload.cardList?.length) {
        return payload;
      }

      return null;
    } catch (error) {
      lastError = error;
      console.error("official Japanese browse API fetch failed", {
        setCode,
        page,
        attempt,
        error,
      });

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
      }
    }
  }

  if (lastError) {
    console.error("official Japanese browse API failed", { setCode, page, lastError });
  }

  return null;
}

export async function fetchOfficialJapaneseSetBrowsePage(
  setCode: string,
  page: number,
): Promise<PokemonCardJpSearchResponse | null> {
  const candidates = buildOfficialJapaneseBrowseSetCodeCandidates(setCode);

  // Seed first. The bundled seed is complete for every official-only supplement
  // set (enforced by `npm run validate:jp-sets` at build time) and is served
  // from memory, so it always returns cards instantly. pokemon-card.com is
  // unreliable/blocked from serverless: a hanging live request (12s timeout ×
  // attempts × candidates × pages) can blow the route's time budget before the
  // seed is ever reached, which surfaced as "No cards found" in production.
  for (const candidate of candidates) {
    const seeded = getOfficialJapaneseBrowseSeedPage(candidate, page);

    if (seeded?.cardList?.length) {
      return seeded;
    }
  }

  // No seed for this set (e.g. a newly released set not yet seeded): prefer the
  // cloud-safe community catalog before touching pokemon-card.com, which often
  // rejects serverless/datacenter IP ranges before headers are considered.
  for (const candidate of candidates) {
    const community = await fetchCommunityJapaneseBrowsePage(candidate, page);

    if (community?.cardList?.length) {
      return community;
    }
  }

  if (shouldSkipOfficialLiveBrowse()) {
    console.error("official Japanese live browse skipped in serverless environment", {
      setCode,
      page,
    });
    return null;
  }

  // Last resort only: direct live scrape of the official Japanese catalog.
  for (const candidate of candidates) {
    const live = await fetchLiveOfficialJapaneseBrowsePage(candidate, page);

    if (live?.cardList?.length) {
      return live;
    }
  }

  return null;
}
