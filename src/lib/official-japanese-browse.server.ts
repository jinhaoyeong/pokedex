import "server-only";

import bundledBrowseSeed from "../../data/official-japanese-browse-seed.json";

import { buildOfficialJapaneseBrowseSetCodeCandidates } from "@/lib/official-japanese-sets.server";

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
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const browseSeed = bundledBrowseSeed as BrowseSeedFile;

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
  const pageSize = 39;
  const cardList = set.cardList ?? [];

  if (!cardList.length) {
    return null;
  }

  const maxPage = Math.max(1, Math.ceil(cardList.length / pageSize));
  const safePage = Math.min(Math.max(1, page), maxPage);
  const start = (safePage - 1) * pageSize;

  return {
    result: 1,
    hitCnt: set.hitCnt ?? cardList.length,
    thisPage: safePage,
    maxPage,
    cardList: cardList.slice(start, start + pageSize),
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

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
      }
    }
  }

  if (lastError) {
    console.warn("official Japanese browse API failed", { setCode, page, lastError });
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

  // No seed for this set (e.g. a newly released set not yet seeded): fall back
  // to the live official catalog API.
  for (const candidate of candidates) {
    const live = await fetchLiveOfficialJapaneseBrowsePage(candidate, page);

    if (live?.cardList?.length) {
      return live;
    }
  }

  return null;
}
