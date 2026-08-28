import "server-only";

import { eq } from "drizzle-orm";

import { lookupBundledJapaneseIdentitySeed } from "@/lib/japanese-identity-seed";
import { withCacheDb } from "@/db/safe-db";
import { cardIdentityMappings } from "@/db/schema";
import { normalizeJapanesePrintedCollectorNumber } from "@/lib/japanese-market-identity";
import {
  readMarketFileCache,
  writeMarketFileCache,
} from "@/lib/market/file-cache.server";
import type {
  JapaneseMarketIdentitySource,
  JapaneseMarketIdentityStatus,
} from "@/types/pokemon";

/**
 * Persistent official-Japanese card identity mappings (Supabase).
 *
 * A Japanese price lookup can't build correct PriceCharting queries until the
 * official cardID has been resolved to the card's PRINTED collector number,
 * set code, and English name. That resolution used to require a live
 * pokemon-card.com round-trip on every request; here it is resolved once,
 * stored forever (the mapping is immutable card identity, not market data),
 * and read back in a single indexed lookup.
 */

export type CardIdentityMapping = {
  officialCardId: string;
  printedCollectorNumber: string | null;
  setCode: string | null;
  englishName: string | null;
  priceChartingSlug: string | null;
  browseIndex?: number | null;
  japaneseName?: string | null;
  englishMarketName?: string | null;
  collectorNumberTotal?: number | null;
  japaneseSetName?: string | null;
  englishSetName?: string | null;
  priceChartingSetSlug?: string | null;
  priceChartingProductId?: string | null;
  priceChartingProductUrl?: string | null;
  identityConfidence?: number | null;
  identitySource?: JapaneseMarketIdentitySource[];
  identityStatus?: JapaneseMarketIdentityStatus | null;
  verifiedAt?: string | null;
  identityVersion?: number;
};

type RuntimeIdentityEntry = { value: CardIdentityMapping; expiresAt: number };
const IDENTITY_RUNTIME_TTL_MS = Number(
  process.env.JAPANESE_IDENTITY_RUNTIME_TTL_MS ?? String(5 * 60 * 1000),
);
const identityRuntime = globalThis as typeof globalThis & {
  __pokedexConfirmedJapaneseIdentityCacheV2?: Map<string, RuntimeIdentityEntry>;
};
const confirmedIdentityCache =
  identityRuntime.__pokedexConfirmedJapaneseIdentityCacheV2 ??
  (identityRuntime.__pokedexConfirmedJapaneseIdentityCacheV2 = new Map());
const IDENTITY_FILE_CACHE_TTL_MS = Number(
  process.env.JAPANESE_IDENTITY_FILE_TTL_MS ?? String(365 * 24 * 60 * 60 * 1000),
);

const IDENTITY_SOURCES = new Set<JapaneseMarketIdentitySource>([
  "official-detail",
  "official-browse",
  "tcgdex",
  "manual-set-map",
  "pricecharting-discovery",
  "cached-confirmed-identity",
  "name-database",
  "caller-supplied",
]);

function parseIdentitySources(value: unknown): JapaneseMarketIdentitySource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (source): source is JapaneseMarketIdentitySource =>
      typeof source === "string" && IDENTITY_SOURCES.has(source as JapaneseMarketIdentitySource),
  );
}

function cloneConfirmedMapping(mapping: CardIdentityMapping): CardIdentityMapping {
  return {
    ...mapping,
    identitySource: [...(mapping.identitySource ?? [])],
  };
}

function mappingHasConfirmedOfficialEvidence(
  candidate: CardIdentityMapping | null | undefined,
) {
  return Boolean(
    candidate &&
      candidate.identityStatus === "confirmed" &&
      normalizeJapanesePrintedCollectorNumber(candidate.printedCollectorNumber) &&
      candidate.identitySource?.includes("official-detail") &&
      Number.isFinite(Date.parse(candidate.verifiedAt ?? "")),
  );
}

function bundledIdentityMapping(officialCardId: string): CardIdentityMapping | null {
  const candidate = lookupBundledJapaneseIdentitySeed(officialCardId);
  if (!candidate) {
    return null;
  }
  return cloneConfirmedMapping({
    officialCardId: candidate.officialCardId,
    printedCollectorNumber: candidate.printedCollectorNumber ?? null,
    setCode: candidate.setCode ?? null,
    englishName: candidate.englishMarketName ?? candidate.englishName ?? null,
    priceChartingSlug: candidate.priceChartingSetSlug ?? candidate.priceChartingSlug ?? null,
    browseIndex: candidate.browseIndex ?? null,
    japaneseName: candidate.japaneseName ?? null,
    englishMarketName: candidate.englishMarketName ?? candidate.englishName ?? null,
    collectorNumberTotal: candidate.collectorNumberTotal ?? null,
    japaneseSetName: candidate.japaneseSetName ?? null,
    englishSetName: candidate.englishSetName ?? null,
    priceChartingSetSlug: candidate.priceChartingSetSlug ?? candidate.priceChartingSlug ?? null,
    priceChartingProductId: candidate.priceChartingProductId ?? null,
    priceChartingProductUrl: candidate.priceChartingProductUrl ?? null,
    identityConfidence: candidate.identityConfidence ?? null,
    identitySource: candidate.identitySource,
    identityStatus: candidate.identityStatus ?? null,
    verifiedAt: candidate.verifiedAt ?? null,
    identityVersion: candidate.identityVersion,
  });
}

async function fallbackIdentityMapping(officialCardId: string) {
  const fileMapping = await readMarketFileCache<CardIdentityMapping>(
    "japanese-identity-v1",
    officialCardId,
    IDENTITY_FILE_CACHE_TTL_MS,
  ).catch(() => null);
  return mappingHasConfirmedOfficialEvidence(fileMapping)
    ? cloneConfirmedMapping(fileMapping!)
    : bundledIdentityMapping(officialCardId);
}

export async function readCardIdentityMapping(
  officialCardId: string | number,
): Promise<CardIdentityMapping | null> {
  const clean = String(officialCardId).trim();

  if (!clean) {
    return null;
  }

  const runtimeHit = confirmedIdentityCache.get(clean);
  if (runtimeHit && runtimeHit.expiresAt > Date.now()) {
    return {
      ...runtimeHit.value,
      identitySource: [...(runtimeHit.value.identitySource ?? [])],
    };
  }
  if (runtimeHit) {
    confirmedIdentityCache.delete(clean);
  }

  const bundled = bundledIdentityMapping(clean);
  if (bundled) {
    confirmedIdentityCache.set(clean, {
      value: bundled,
      expiresAt: Date.now() + IDENTITY_RUNTIME_TTL_MS,
    });
    return cloneConfirmedMapping(bundled);
  }

  const rows = await withCacheDb((db) =>
    db
      .select()
      .from(cardIdentityMappings)
      .where(eq(cardIdentityMappings.officialCardId, clean))
      .limit(1),
  );
  const row = rows?.[0];

  if (!row) {
    const fallback = await fallbackIdentityMapping(clean);
    if (!fallback) {
      return null;
    }
    confirmedIdentityCache.set(clean, {
      value: fallback,
      expiresAt: Date.now() + IDENTITY_RUNTIME_TTL_MS,
    });
    return cloneConfirmedMapping(fallback);
  }

  const mapping: CardIdentityMapping = {
    officialCardId: row.officialCardId,
    printedCollectorNumber: row.printedCollectorNumber,
    setCode: row.setCode,
    englishName: row.englishName,
    priceChartingSlug: row.priceChartingSlug,
    browseIndex: row.browseIndex,
    japaneseName: row.japaneseName,
    englishMarketName: row.englishName,
    collectorNumberTotal: row.collectorNumberTotal,
    japaneseSetName: row.japaneseSetName,
    englishSetName: row.englishSetName,
    priceChartingSetSlug: row.priceChartingSlug,
    priceChartingProductId: row.priceChartingProductId,
    priceChartingProductUrl: row.priceChartingProductUrl,
    identityConfidence:
      row.identityConfidence === null ? null : Number(row.identityConfidence),
    identitySource: parseIdentitySources(row.identitySource),
    identityStatus:
      row.identityStatus === "confirmed" ||
      row.identityStatus === "partial" ||
      row.identityStatus === "identity_incomplete"
        ? row.identityStatus
        : null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    identityVersion: Math.max(1, row.identityVersion ?? 1),
  };
  // Legacy rows predate provenance/version columns and may still contain a
  // browse position. Prefer a bundled/file identity with confirmed official
  // evidence until that database row is refreshed by the canonical resolver.
  const resolvedMapping = mappingHasConfirmedOfficialEvidence(mapping)
    ? mapping
    : (await fallbackIdentityMapping(clean)) ?? mapping;
  confirmedIdentityCache.set(clean, {
    value: resolvedMapping,
    expiresAt: Date.now() + IDENTITY_RUNTIME_TTL_MS,
  });
  return cloneConfirmedMapping(resolvedMapping);
}

/** Upsert a mapping. Best-effort: returns false when the database is unavailable. */
export async function writeCardIdentityMapping(
  mapping: CardIdentityMapping,
): Promise<boolean> {
  const clean = mapping.officialCardId.trim();

  if (!clean) {
    return false;
  }

  const printedCollectorNumber = normalizeJapanesePrintedCollectorNumber(
    mapping.printedCollectorNumber,
  );
  const identitySource = parseIdentitySources(mapping.identitySource);
  const verifiedAtMs = Date.parse(mapping.verifiedAt ?? "");

  // This store is authoritative identity, not a scratch cache. Browse positions,
  // guesses, and legacy callers without official-detail provenance are rejected.
  if (
    !printedCollectorNumber ||
    mapping.identityStatus !== "confirmed" ||
    !identitySource.includes("official-detail") ||
    !Number.isFinite(verifiedAtMs)
  ) {
    return false;
  }

  const runtimeMapping: CardIdentityMapping = {
    ...mapping,
    officialCardId: clean,
    printedCollectorNumber,
    englishName: mapping.englishMarketName ?? mapping.englishName,
    priceChartingSlug: mapping.priceChartingSetSlug ?? mapping.priceChartingSlug,
    identitySource,
    identityStatus: "confirmed",
    verifiedAt: new Date(verifiedAtMs).toISOString(),
    identityVersion: Math.max(1, Math.trunc(mapping.identityVersion ?? 1)),
  };
  confirmedIdentityCache.set(clean, {
    value: runtimeMapping,
    expiresAt: Date.now() + IDENTITY_RUNTIME_TTL_MS,
  });
  const fileWrite = writeMarketFileCache(
    "japanese-identity-v1",
    clean,
    runtimeMapping,
  )
    .then(() => true)
    .catch(() => false);

  const now = new Date();
  const priceChartingSlug = mapping.priceChartingSetSlug ?? mapping.priceChartingSlug;
  const englishName = mapping.englishMarketName ?? mapping.englishName;
  const verifiedAt = new Date(verifiedAtMs);
  const written = await withCacheDb(async (db) => {
    await db
      .insert(cardIdentityMappings)
      .values({
        officialCardId: clean,
        browseIndex: mapping.browseIndex ?? null,
        japaneseName: mapping.japaneseName ?? null,
        printedCollectorNumber,
        collectorNumberTotal: mapping.collectorNumberTotal ?? null,
        setCode: mapping.setCode,
        japaneseSetName: mapping.japaneseSetName ?? null,
        englishName,
        englishSetName: mapping.englishSetName ?? null,
        priceChartingSlug,
        priceChartingProductId: mapping.priceChartingProductId ?? null,
        priceChartingProductUrl: mapping.priceChartingProductUrl ?? null,
        identityConfidence: Math.max(0, Math.min(1, mapping.identityConfidence ?? 0)).toFixed(4),
        identitySource,
        identityStatus: "confirmed",
        verifiedAt,
        identityVersion: Math.max(1, Math.trunc(mapping.identityVersion ?? 1)),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: cardIdentityMappings.officialCardId,
        set: {
          browseIndex: mapping.browseIndex ?? null,
          japaneseName: mapping.japaneseName ?? null,
          printedCollectorNumber,
          collectorNumberTotal: mapping.collectorNumberTotal ?? null,
          setCode: mapping.setCode,
          japaneseSetName: mapping.japaneseSetName ?? null,
          englishName,
          englishSetName: mapping.englishSetName ?? null,
          priceChartingSlug,
          priceChartingProductId: mapping.priceChartingProductId ?? null,
          priceChartingProductUrl: mapping.priceChartingProductUrl ?? null,
          identityConfidence: Math.max(0, Math.min(1, mapping.identityConfidence ?? 0)).toFixed(4),
          identitySource,
          identityStatus: "confirmed",
          verifiedAt,
          identityVersion: Math.max(1, Math.trunc(mapping.identityVersion ?? 1)),
          updatedAt: now,
        },
      });

    return true;
  });

  return written === true || (await fileWrite);
}
