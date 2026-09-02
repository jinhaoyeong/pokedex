import "server-only";

import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { isDatabaseConfigured } from "@/db/client";
import { buildPostgresOptions, resolveDatabaseUrl } from "@/db/connection-options";
import { marketObservations } from "@/db/schema";
import {
  aggregateMarketObservations,
  findPokedexMarketGuideEntry,
  isUsableMarketPriceUsd,
  mergeSeedAndLiveMarketGuide,
  normalizeCollectorNumber,
  normalizeMarketGrade,
  normalizeMarketText,
  pokedexMarketGuideToProviderResult,
  roundMarketUsd,
  type PokedexMarketGuideQuery,
  type PokedexMarketObservation,
} from "@/lib/market/pokedex-market-guide";
import type { PriceQuery, ProviderPriceResult } from "@/lib/price/types";

export type RecordPokedexMarketInput = {
  slug: string;
  grade?: string;
  priceUsd: number;
  kind: "sold" | "paid";
  contributorKey: string;
  setCode?: string;
  collectorNumber?: string;
  language?: string;
  name?: string;
  source?: string;
};

const LIVE_LOOKUP_TTL_MS = 15_000;
const WRITE_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 4_000;

type LiveLookupMemo = {
  expiresAt: number;
  value: ProviderPriceResult | null;
};

const liveLookupMemo = new Map<string, LiveLookupMemo>();
const liveLookupInflight = new Map<string, Promise<ProviderPriceResult | null>>();

let observationDb: ReturnType<typeof drizzle> | null = null;
let observationDbUrl = "";

function getObservationDb() {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  if (!observationDb || observationDbUrl !== url) {
    observationDb = drizzle(postgres(url, { ...buildPostgresOptions(url), max: 1 }), {
      schema: { marketObservations },
    });
    observationDbUrl = url;
  }
  return observationDb;
}

function toMoney(value: number) {
  return roundMarketUsd(value).toFixed(2);
}

function parseMoney(value: string | null | undefined) {
  if (value == null) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeoutNull(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
}

function timeoutError(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
}

function liveLookupKey(query: PokedexMarketGuideQuery) {
  return [
    normalizeMarketText(query.slug),
    normalizeMarketText(query.setCode),
    normalizeCollectorNumber(query.collectorNumber),
    normalizeMarketText(query.language) || "en",
  ].join("|");
}

export function invalidatePokedexMarketGuideLive(slug: string) {
  const needle = normalizeMarketText(slug);
  if (!needle) {
    return;
  }
  for (const key of liveLookupMemo.keys()) {
    if (key.split("|")[0] === needle) {
      liveLookupMemo.delete(key);
    }
  }
}

export async function recordPokedexMarketObservation(
  input: RecordPokedexMarketInput,
): Promise<boolean> {
  const slug = normalizeMarketText(input.slug);
  const contributorKey = input.contributorKey.trim().slice(0, 160);
  if (!slug || !contributorKey || !isUsableMarketPriceUsd(input.priceUsd)) {
    return false;
  }
  if (!isDatabaseConfigured()) {
    return false;
  }

  const grade = normalizeMarketGrade(input.grade);
  const kind = input.kind === "sold" ? "sold" : "paid";
  const setCode = normalizeMarketText(input.setCode) || null;
  const collectorNumber = normalizeCollectorNumber(input.collectorNumber) || null;
  const language = normalizeMarketText(input.language) || "en";
  const cardName = input.name?.trim() || null;
  const source = input.source?.trim() || "pokedex-binder";
  const priceUsd = toMoney(input.priceUsd);
  const observedAt = new Date();

  try {
    const written = await Promise.race([
      (async () => {
        const db = getObservationDb();
        await db
          .insert(marketObservations)
          .values({
            cardSlug: slug,
            source,
            kind,
            grade,
            contributorKey,
            setCode,
            collectorNumber,
            language,
            cardName,
            priceUsd,
            currency: "USD",
            observedAt,
          })
          .onConflictDoUpdate({
            target: [
              marketObservations.contributorKey,
              marketObservations.cardSlug,
              marketObservations.grade,
              marketObservations.kind,
            ],
            set: {
              priceUsd,
              setCode,
              collectorNumber,
              language,
              cardName,
              source,
              observedAt,
            },
          });
        return true;
      })(),
      timeoutNull(WRITE_TIMEOUT_MS),
    ]);
    if (!written) {
      return false;
    }
    invalidatePokedexMarketGuideLive(slug);
    return true;
  } catch {
    return false;
  }
}

async function loadLiveMarketEntry(query: PokedexMarketGuideQuery) {
  const slug = normalizeMarketText(query.slug);
  const setCode = normalizeMarketText(query.setCode);
  const collectorNumber = normalizeCollectorNumber(query.collectorNumber);
  const language = normalizeMarketText(query.language) || "en";

  if (!slug && !(setCode && collectorNumber)) {
    return null;
  }
  if (!isDatabaseConfigured()) {
    return null;
  }

  const rows = await Promise.race([
    (async () => {
      const slugMatch = slug ? eq(marketObservations.cardSlug, slug) : undefined;
      const printMatch =
        setCode && collectorNumber
          ? and(
              eq(marketObservations.setCode, setCode),
              eq(marketObservations.collectorNumber, collectorNumber),
              eq(marketObservations.language, language),
            )
          : undefined;
      const where =
        slugMatch && printMatch ? or(slugMatch, printMatch) : (slugMatch ?? printMatch);

      if (!where) {
        return [];
      }

      return getObservationDb().select().from(marketObservations).where(where).limit(2_000);
    })(),
    timeoutError(READ_TIMEOUT_MS, "observation-db timeout"),
  ]);

  if (!rows?.length) {
    return null;
  }

  const observations: PokedexMarketObservation[] = [];
  for (const row of rows) {
    const priceUsd = parseMoney(row.priceUsd);
    if (!isUsableMarketPriceUsd(priceUsd) || !row.contributorKey.trim()) {
      continue;
    }
    if (row.kind !== "sold" && row.kind !== "paid") {
      continue;
    }
    observations.push({
      priceUsd,
      kind: row.kind,
      grade: row.grade,
      contributorKey: row.contributorKey,
      observedAt: row.observedAt.toISOString(),
    });
  }

  return aggregateMarketObservations(observations, {
    slug: query.slug,
    setCode: query.setCode,
    collectorNumber: query.collectorNumber,
    language: language || query.language,
    name: query.name,
    englishName: query.englishName,
  });
}

export async function lookupPokedexMarketGuideLive(
  query: PokedexMarketGuideQuery | PriceQuery,
): Promise<ProviderPriceResult | null> {
  const key = liveLookupKey(query);
  const cached = liveLookupMemo.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const pending = liveLookupInflight.get(key);
  if (pending) {
    return pending;
  }

  const run = (async () => {
    const seed = findPokedexMarketGuideEntry(query);
    try {
      const live = await loadLiveMarketEntry(query);
      const merged = mergeSeedAndLiveMarketGuide(seed, live);
      const value = merged ? pokedexMarketGuideToProviderResult(merged) : null;
      liveLookupMemo.set(key, { expiresAt: Date.now() + LIVE_LOOKUP_TTL_MS, value });
      return value;
    } catch {
      return seed ? pokedexMarketGuideToProviderResult(seed) : null;
    }
  })().finally(() => {
    liveLookupInflight.delete(key);
  });

  liveLookupInflight.set(key, run);
  return run;
}
