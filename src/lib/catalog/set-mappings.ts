import type { CardLanguageCode } from "@/types/pokemon";

import { readCatalogJson, writeCatalogJson } from "@/lib/catalog/file-store";
import { isDatabaseEnabled, prisma } from "@/lib/db";
import { normalizeSetId, SUPPORTED_INGEST_LANGUAGES } from "@/lib/catalog/identity";

const TCGDEX_API_BASE_URL = "https://api.tcgdex.net/v2";

export type SetMappingRecord = {
  englishSetId: string;
  language: CardLanguageCode;
  localizedSetId: string;
  releaseDate?: string;
  englishCount?: number;
  localizedCount?: number;
  confidence: number;
  method: string;
};

type TcgdexSetBrief = {
  id: string;
  name: string;
  releaseDate?: string;
  cardCount?: { official?: number; total?: number };
};

let memoryMappings: { expiresAt: number; byLanguage: Map<string, Map<string, string>> } | null =
  null;
const MAPPING_TTL_MS = 30 * 60 * 1000;

async function fetchTcgdexSets(language: string): Promise<TcgdexSetBrief[]> {
  const response = await fetch(`${TCGDEX_API_BASE_URL}/${language}/sets`, {
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    return [];
  }

  return (await response.json()) as TcgdexSetBrief[];
}

function buildMappingsFromSets(
  englishSets: TcgdexSetBrief[],
  localizedSets: TcgdexSetBrief[],
  language: CardLanguageCode,
): SetMappingRecord[] {
  const mappings: SetMappingRecord[] = [];

  for (const englishSet of englishSets) {
    const englishCount = englishSet.cardCount?.official ?? englishSet.cardCount?.total ?? 0;
    if (!englishCount) {
      continue;
    }

    const exact = localizedSets.find(
      (localizedSet) => normalizeSetId(localizedSet.id) === normalizeSetId(englishSet.id),
    );

    if (exact) {
      mappings.push({
        englishSetId: englishSet.id,
        language,
        localizedSetId: exact.id,
        releaseDate: englishSet.releaseDate,
        englishCount,
        localizedCount: exact.cardCount?.official ?? exact.cardCount?.total,
        confidence: 1,
        method: "identical_set_id",
      });
      continue;
    }

    const candidates = localizedSets
      .map((localizedSet) => {
        const localizedCount =
          localizedSet.cardCount?.official ?? localizedSet.cardCount?.total ?? 0;
        const countDelta = Math.abs(localizedCount - englishCount);
        const idSimilarity =
          normalizeSetId(localizedSet.id).includes(normalizeSetId(englishSet.id)) ||
          normalizeSetId(englishSet.id).includes(normalizeSetId(localizedSet.id))
            ? 0.15
            : 0;

        return {
          localizedSet,
          countDelta,
          score: countDelta / Math.max(englishCount, 1) - idSimilarity,
        };
      })
      .filter(
        (candidate) =>
          candidate.countDelta <= Math.max(8, Math.ceil(englishCount * 0.2)),
      )
      .sort((left, right) => left.score - right.score);

    const best = candidates[0]?.localizedSet;
    if (!best) {
      continue;
    }

    const countDelta = candidates[0].countDelta;
    const confidence = Math.max(
      0.42,
      Math.min(0.9, 0.9 - countDelta / Math.max(englishCount, 1)),
    );

    mappings.push({
      englishSetId: englishSet.id,
      language,
      localizedSetId: best.id,
      releaseDate: englishSet.releaseDate,
      englishCount,
      localizedCount: best.cardCount?.official ?? best.cardCount?.total,
      confidence,
      method: "card_count_match",
    });
  }

  return mappings;
}

export async function generateSetMappings(): Promise<SetMappingRecord[]> {
  const englishSets = await fetchTcgdexSets("en");
  const allMappings: SetMappingRecord[] = [];

  for (const language of SUPPORTED_INGEST_LANGUAGES) {
    if (language === "en") {
      continue;
    }

    const apiLanguage =
      language === "zh-cn" ? "zh-tw" : language === "pt" || language === "pt-pt" ? "pt-br" : language;
    const localizedSets = await fetchTcgdexSets(apiLanguage);
    allMappings.push(...buildMappingsFromSets(englishSets, localizedSets, language));
  }

  const unique = new Map<string, SetMappingRecord>();
  for (const mapping of allMappings) {
    const key = `${mapping.language}:${mapping.englishSetId}`;
    const existing = unique.get(key);
    if (!existing || mapping.confidence > existing.confidence) {
      unique.set(key, mapping);
    }
  }

  return [...unique.values()];
}

async function loadMappingsFromDatabase() {
  if (!isDatabaseEnabled() || !prisma) {
    return null;
  }

  const rows = await prisma.setMapping.findMany();
  return rows.map((row) => ({
    englishSetId: row.englishSetId,
    language: row.language as CardLanguageCode,
    localizedSetId: row.localizedSetId,
    releaseDate: row.releaseDate ?? undefined,
    englishCount: row.englishCount ?? undefined,
    localizedCount: row.localizedCount ?? undefined,
    confidence: row.confidence,
    method: row.method,
  }));
}

async function loadMappingsFromFile() {
  return readCatalogJson<SetMappingRecord[]>("set-mappings.json");
}

function indexMappings(records: SetMappingRecord[]) {
  const byLanguage = new Map<string, Map<string, string>>();

  for (const record of records) {
    const langMap = byLanguage.get(record.language) ?? new Map<string, string>();
    langMap.set(normalizeSetId(record.englishSetId), record.localizedSetId);
    langMap.set(normalizeSetId(record.localizedSetId), record.localizedSetId);
    byLanguage.set(record.language, langMap);
  }

  return byLanguage;
}

export async function getSetMappingIndex() {
  const now = Date.now();
  if (memoryMappings && memoryMappings.expiresAt > now) {
    return memoryMappings.byLanguage;
  }

  const records = (await loadMappingsFromDatabase()) ?? (await loadMappingsFromFile()) ?? [];
  const byLanguage = indexMappings(records);
  memoryMappings = {
    expiresAt: now + MAPPING_TTL_MS,
    byLanguage,
  };

  return byLanguage;
}

export async function resolveLocalizedSetId(
  language: CardLanguageCode,
  setFilter: string,
): Promise<string | null> {
  const clean = setFilter.trim();
  if (!clean) {
    return null;
  }

  const index = await getSetMappingIndex();
  const langMap = index.get(language);
  if (!langMap) {
    return null;
  }

  return (
    langMap.get(normalizeSetId(clean)) ??
    langMap.get(normalizeSetId(clean.toUpperCase())) ??
    langMap.get(normalizeSetId(clean.toLowerCase())) ??
    null
  );
}

export async function persistSetMappings(records: SetMappingRecord[]) {
  await writeCatalogJson("set-mappings.json", records);

  if (!isDatabaseEnabled() || !prisma) {
    return { file: records.length, database: 0 };
  }

  let database = 0;
  for (const record of records) {
    await prisma.setMapping.upsert({
      where: {
        englishSetId_language_localizedSetId: {
          englishSetId: record.englishSetId,
          language: record.language,
          localizedSetId: record.localizedSetId,
        },
      },
      create: {
        englishSetId: record.englishSetId,
        language: record.language,
        localizedSetId: record.localizedSetId,
        releaseDate: record.releaseDate,
        englishCount: record.englishCount,
        localizedCount: record.localizedCount,
        confidence: record.confidence,
        method: record.method,
      },
      update: {
        releaseDate: record.releaseDate,
        englishCount: record.englishCount,
        localizedCount: record.localizedCount,
        confidence: record.confidence,
        method: record.method,
      },
    });
    database += 1;
  }

  memoryMappings = null;
  return { file: records.length, database };
}
