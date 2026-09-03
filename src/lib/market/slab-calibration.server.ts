import "server-only";

import { eq, inArray } from "drizzle-orm";

import { withCacheDb } from "@/db/safe-db";
import { cardsCatalog, marketObservations } from "@/db/schema";
import {
  buildSlabCalibration,
  type SlabCalibration,
  type SlabCalibrationObservation,
} from "@/lib/market/slab-calibration";
import {
  classifySlabEra,
  classifySlabRarity,
  type SlabEstimateGrade,
} from "@/lib/market/slab-estimate-v1";

const CALIBRATION_TTL_MS = 5 * 60_000;
const CALIBRATION_READ_BUDGET_MS = 650;

let cachedRows: { expiresAt: number; rows: SlabCalibrationObservation[] } | null = null;
let inflight: Promise<SlabCalibrationObservation[]> | null = null;

function grade(value: string): "Ungraded" | SlabEstimateGrade | null {
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  if (normalized === "UNGRADED" || normalized === "RAW") return "Ungraded";
  if (normalized === "PSA 9") return "PSA 9";
  if (normalized === "PSA 10") return "PSA 10";
  return null;
}

function parseUsd(value: string | null) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function metadataValue(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
}

async function readRows() {
  if (cachedRows && cachedRows.expiresAt > Date.now()) return cachedRows.rows;
  if (inflight) return inflight;

  inflight = (async () => {
    const rows = await withCacheDb((db) =>
      db
        .select({
          cardSlug: marketObservations.cardSlug,
          contributorKey: marketObservations.contributorKey,
          grade: marketObservations.grade,
          priceUsd: marketObservations.priceUsd,
          language: marketObservations.language,
          catalogLanguage: cardsCatalog.languageCode,
          releaseYear: cardsCatalog.releaseYear,
          rarity: cardsCatalog.rarity,
          metadata: marketObservations.metadata,
        })
        .from(marketObservations)
        .leftJoin(cardsCatalog, eq(marketObservations.cardSlug, cardsCatalog.slug))
        .where(inArray(marketObservations.grade, ["Ungraded", "PSA 9", "PSA 10"]))
        .limit(20_000),
    );
    const normalized = (rows ?? []).flatMap((row) => {
      const normalizedGrade = grade(row.grade);
      const priceUsd = parseUsd(row.priceUsd);
      if (
        !normalizedGrade ||
        !priceUsd ||
        !row.cardSlug ||
        !row.contributorKey.startsWith("clerk:")
      ) return [];
      return [{
        cardKey: row.cardSlug,
        contributorKey: row.contributorKey,
        grade: normalizedGrade,
        priceUsd,
        era: classifySlabEra(
          row.releaseYear
            ? `${row.releaseYear}-01-01`
            : metadataValue(row.metadata, "releaseDate"),
        ),
        rarity: classifySlabRarity(row.rarity || metadataValue(row.metadata, "rarity")),
        language: row.language || row.catalogLanguage || "en",
      } satisfies SlabCalibrationObservation];
    });
    cachedRows = { expiresAt: Date.now() + CALIBRATION_TTL_MS, rows: normalized };
    return normalized;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function timeoutEmpty() {
  return new Promise<SlabCalibrationObservation[]>((resolve) => {
    const timer = setTimeout(() => resolve([]), CALIBRATION_READ_BUDGET_MS);
    timer.unref?.();
  });
}

/** Best-effort learned ratios. A missing/unreachable database returns no calibration. */
export async function lookupFirstPartySlabCalibration(input: {
  cardSlug?: string | null;
  releaseDate?: string | null;
  rarity?: string | null;
  language: string;
}): Promise<SlabCalibration> {
  const rows = await Promise.race([readRows(), timeoutEmpty()]);
  return buildSlabCalibration(rows, {
    cardKey: input.cardSlug?.trim().toLowerCase(),
    era: classifySlabEra(input.releaseDate),
    rarity: classifySlabRarity(input.rarity),
    language: input.language,
  });
}
