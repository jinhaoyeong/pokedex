import "server-only";

import fs from "node:fs";
import path from "node:path";

import bundledSupplements from "../../data/official-japanese-set-supplements.json";

import {
  buildJapaneseOfficialBrowseCodeVariants,
  canonicalJapaneseSetFilterValue,
} from "@/lib/japanese-set-filter";
import type { TcgSet } from "@/types/pokemon";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import { compareTcgSetsForDisplay } from "@/lib/set-display-sort";

export { canonicalJapaneseSetFilterValue };

function getSupplementsPathCandidates() {
  const roots = new Set<string>([process.cwd(), path.join(process.cwd(), "..")]);

  if (process.env.VERCEL) {
    roots.add(path.join(process.cwd(), ".next", "standalone"));
  }

  return [...roots].map((root) => path.join(root, "data", "official-japanese-set-supplements.json"));
}

function resolveSupplementsPath() {
  for (const candidate of getSupplementsPathCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(process.cwd(), "data", "official-japanese-set-supplements.json");
}

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

let supplementsCache: OfficialJapaneseSetSupplement[] | null = null;
let supplementsCacheMtimeMs = -1;

function loadBundledSupplements(): OfficialJapaneseSetSupplement[] {
  const payload = bundledSupplements as SupplementsFile;
  return Array.isArray(payload.sets) ? payload.sets : [];
}

function loadSupplementsFile(): OfficialJapaneseSetSupplement[] {
  const supplementsPath = resolveSupplementsPath();

  if (!fs.existsSync(supplementsPath)) {
    supplementsCache = loadBundledSupplements();
    supplementsCacheMtimeMs = -1;
    return supplementsCache;
  }

  try {
    // Cache parsed supplements in memory and only re-read when the file's mtime
    // changes. This is read on every ja/all set-filter request and repeatedly
    // during Japanese card search, so re-parsing JSON from disk each call was
    // pure overhead.
    const mtimeMs = fs.statSync(supplementsPath).mtimeMs;

    if (supplementsCache && supplementsCacheMtimeMs === mtimeMs) {
      return supplementsCache;
    }

    const payload = JSON.parse(fs.readFileSync(supplementsPath, "utf8")) as SupplementsFile;
    supplementsCache = Array.isArray(payload.sets) ? payload.sets : [];
    supplementsCacheMtimeMs = mtimeMs;
    return supplementsCache;
  } catch {
    return supplementsCache ?? loadBundledSupplements();
  }
}

export function buildOfficialJapaneseBrowseSetCodeCandidates(setIdOrCode: string) {
  const trimmed = setIdOrCode.trim();

  if (!trimmed) {
    return [];
  }

  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  const candidates = new Set<string>(buildJapaneseOfficialBrowseCodeVariants(trimmed));
  const supplement = getOfficialJapaneseSetSupplements().find(
    (entry) =>
      entry.id.trim().toUpperCase() === upper ||
      entry.code.trim().toUpperCase() === upper ||
      entry.id.trim().toLowerCase() === lower,
  );

  if (supplement?.officialBrowseCode?.trim()) {
    candidates.add(supplement.officialBrowseCode.trim().toUpperCase());
  }

  if (supplement?.code?.trim()) {
    for (const candidate of buildJapaneseOfficialBrowseCodeVariants(supplement.code)) {
      candidates.add(candidate);
    }
  }

  if (supplement?.id?.trim()) {
    for (const candidate of buildJapaneseOfficialBrowseCodeVariants(supplement.id)) {
      candidates.add(candidate);
    }
  }

  return [...candidates].filter(Boolean);
}

export function resolveOfficialJapaneseBrowseCodes(
  ...inputs: Array<string | null | undefined>
) {
  const candidates = new Set<string>();

  for (const input of inputs) {
    if (!input?.trim()) {
      continue;
    }

    for (const candidate of buildOfficialJapaneseBrowseSetCodeCandidates(input)) {
      candidates.add(candidate);
    }
  }

  return [...candidates];
}

function getOfficialJapaneseSetSupplements() {
  return loadSupplementsFile();
}

function supplementToTcgSet(entry: OfficialJapaneseSetSupplement): TcgSet {
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

function buildOfficialJapaneseSetSearchText(entry: OfficialJapaneseSetSupplement) {
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

export function isOfficialJapaneseSupplementSetCode(setCode?: string | null): boolean {
  if (!setCode?.trim()) {
    return false;
  }

  const key = setCode.trim().toUpperCase();

  return getOfficialJapaneseSetSupplements().some(
    (supplement) =>
      supplement.id.trim().toUpperCase() === key ||
      supplement.code.trim().toUpperCase() === key ||
      supplement.officialBrowseCode.trim().toUpperCase() === key,
  );
}

export function getOfficialJapaneseSetSupplementById(setId: string): TcgSet | null {
  const key = setId.trim().toUpperCase();
  const entry = getOfficialJapaneseSetSupplements().find(
    (supplement) =>
      supplement.id.trim().toUpperCase() === key ||
      supplement.code.trim().toUpperCase() === key,
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
    const canonical = supplementToTcgSet(entry);

    byId.set(key, canonical);

    if (entry.code.trim().toUpperCase() !== key) {
      byId.set(entry.code.trim().toUpperCase(), canonical);
    }
  }

  return [...byId.values()].sort(compareTcgSetsForDisplay);
}
