import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { TcgSet } from "@/types/pokemon";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import { compareTcgSetsForDisplay } from "@/lib/set-display-sort";

const POKEMON_CARD_JP_BASE_URL = "https://www.pokemon-card.com";
const SUPPLEMENTS_PATH = path.join(
  process.cwd(),
  "data",
  "official-japanese-set-supplements.json",
);

export type OfficialJapaneseSetSupplement = {
  id: string;
  code: string;
  localizedName: string;
  englishName: string;
  releaseDate?: string;
  printedTotal?: number;
  total?: number;
  officialBrowseCode: string;
};

type SupplementsFile = {
  version: number;
  updatedAt?: string;
  sets: OfficialJapaneseSetSupplement[];
};

function normalizeForSearch(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function loadSupplementsFile(): OfficialJapaneseSetSupplement[] {
  if (!fs.existsSync(SUPPLEMENTS_PATH)) {
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(SUPPLEMENTS_PATH, "utf8")) as SupplementsFile;
    return Array.isArray(payload.sets) ? payload.sets : [];
  } catch {
    return [];
  }
}

export function getOfficialJapaneseSetSupplements() {
  return loadSupplementsFile();
}

export function supplementToTcgSet(entry: OfficialJapaneseSetSupplement): TcgSet {
  const localizedName = entry.localizedName.trim();
  const englishName = entry.englishName.trim();
  const displayName =
    englishName && englishName !== localizedName
      ? `${localizedName} (${englishName})`
      : localizedName;

  return {
    id: entry.id,
    name: displayName,
    localizedName,
    englishName,
    code: entry.code.trim().toUpperCase(),
    series: LANGUAGE_LABELS.ja,
    releaseDate: entry.releaseDate ?? "",
    language: "ja",
    languageLabel: LANGUAGE_LABELS.ja,
    printedTotal: entry.printedTotal,
    total: entry.total ?? entry.printedTotal,
  };
}

export function buildOfficialJapaneseSetSearchText(entry: OfficialJapaneseSetSupplement) {
  return normalizeForSearch(
    [
      entry.localizedName,
      entry.englishName,
      entry.code,
      entry.id,
      entry.officialBrowseCode,
      LANGUAGE_LABELS.ja,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function getOfficialJapaneseSetSupplementById(setId: string): TcgSet | null {
  const key = setId.trim().toUpperCase();
  const entry = getOfficialJapaneseSetSupplements().find(
    (supplement) => supplement.id.trim().toUpperCase() === key,
  );

  return entry ? supplementToTcgSet(entry) : null;
}

export function searchOfficialJapaneseSetSupplements(query: string, limit = 80): TcgSet[] {
  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return [];
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return [];
  }

  return getOfficialJapaneseSetSupplements()
    .filter((entry) => {
      const haystack = buildOfficialJapaneseSetSearchText(entry);
      return terms.every((term) => haystack.includes(term));
    })
    .slice(0, limit)
    .map(supplementToTcgSet);
}

export function mergeOfficialJapaneseSetSupplements(sets: TcgSet[]): TcgSet[] {
  const supplements = getOfficialJapaneseSetSupplements();

  if (!supplements.length) {
    return sets;
  }

  const byId = new Map<string, TcgSet>();

  for (const set of sets) {
    byId.set(set.id.trim().toUpperCase(), set);
  }

  for (const entry of supplements) {
    const key = entry.id.trim().toUpperCase();

    if (!byId.has(key)) {
      byId.set(key, supplementToTcgSet(entry));
    }
  }

  return [...byId.values()].sort(compareTcgSetsForDisplay);
}

export async function probeOfficialJapaneseSetCardCount(
  officialBrowseCode: string,
): Promise<number> {
  const params = new URLSearchParams({
    keyword: "",
    regulation_sidebar_form: "all",
    pg: officialBrowseCode,
    illust: "",
    sm_and_keyword: "true",
    page: "1",
  });

  try {
    const response = await fetch(
      `${POKEMON_CARD_JP_BASE_URL}/card-search/resultAPI.php?${params.toString()}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PokePokedex/1.0)",
        },
      },
    );

    if (!response.ok) {
      return 0;
    }

    const payload = (await response.json()) as { hitCnt?: number };
    return typeof payload.hitCnt === "number" ? payload.hitCnt : 0;
  } catch {
    return 0;
  }
}
