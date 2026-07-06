import "server-only";

import { eq } from "drizzle-orm";

import { withCacheDb } from "@/db/safe-db";
import { cardIdentityMappings } from "@/db/schema";

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
};

export async function readCardIdentityMapping(
  officialCardId: string | number,
): Promise<CardIdentityMapping | null> {
  const clean = String(officialCardId).trim();

  if (!clean) {
    return null;
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
    return null;
  }

  return {
    officialCardId: row.officialCardId,
    printedCollectorNumber: row.printedCollectorNumber,
    setCode: row.setCode,
    englishName: row.englishName,
    priceChartingSlug: row.priceChartingSlug,
  };
}

/** Upsert a mapping. Best-effort: returns false when the database is unavailable. */
export async function writeCardIdentityMapping(
  mapping: CardIdentityMapping,
): Promise<boolean> {
  const clean = mapping.officialCardId.trim();

  if (!clean) {
    return false;
  }

  const now = new Date();
  const written = await withCacheDb(async (db) => {
    await db
      .insert(cardIdentityMappings)
      .values({
        officialCardId: clean,
        printedCollectorNumber: mapping.printedCollectorNumber,
        setCode: mapping.setCode,
        englishName: mapping.englishName,
        priceChartingSlug: mapping.priceChartingSlug,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: cardIdentityMappings.officialCardId,
        set: {
          printedCollectorNumber: mapping.printedCollectorNumber,
          setCode: mapping.setCode,
          englishName: mapping.englishName,
          priceChartingSlug: mapping.priceChartingSlug,
          updatedAt: now,
        },
      });

    return true;
  });

  return written === true;
}
