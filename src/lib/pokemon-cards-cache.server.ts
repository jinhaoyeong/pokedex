import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  appendLearningSource,
  computeTrustScore,
  deriveIdentityStatus,
  derivePriceStatus,
  isCacheStale,
  type FieldTrustStatus,
} from "@/lib/card-confidence";
import type { ParsedCardFeedback } from "@/lib/feedback-parser";
import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

type CollectorLookup = {
  number: string;
  printedTotal?: number;
};

export type CachedCardMeta = {
  slug: string;
  searchHits: number;
  detailViews: number;
  wrongPriceFlags: number;
  wrongCardFlags: number;
  trustScore: number;
  identityStatus: FieldTrustStatus;
  priceStatus: FieldTrustStatus;
  lastEnrichedAt: string | null;
  lastSearchedAt: string;
  needsRefresh: boolean;
};

type CachedCardRow = {
  slug: string;
  language_code: string;
  collector_number: string | null;
  printed_total: number | null;
  card_json: string;
  query_text: string | null;
  search_blob: string | null;
  hit_count: number;
  last_searched_at: string;
  enriched_at: string | null;
  identity_status: string | null;
  price_status: string | null;
  trust_score: number | null;
  search_hits: number | null;
  detail_views: number | null;
  wrong_price_flags: number | null;
  wrong_card_flags: number | null;
};

const WRITE_RETRY_MS = 60_000;
let readDatabase: Database.Database | null = null;
let writeDatabaseUnavailable = false;
let writeDatabaseUnavailableAt = 0;
let seedImported = false;

const CARD_SELECT = `slug, language_code, collector_number, printed_total, card_json, query_text,
  search_blob, hit_count, last_searched_at, enriched_at, identity_status, price_status,
  trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags`;

function getDatabasePath() {
  return path.join(process.cwd(), "data", "pokemon-cards-cache.sqlite");
}

function getSeedPath() {
  return path.join(process.cwd(), "data", "pokemon-cards-seed.json");
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_search_cache (
      slug TEXT PRIMARY KEY,
      language_code TEXT NOT NULL,
      collector_number TEXT,
      printed_total INTEGER,
      card_json TEXT NOT NULL,
      query_text TEXT,
      search_blob TEXT,
      hit_count INTEGER NOT NULL DEFAULT 1,
      last_searched_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      enriched_at TEXT,
      identity_status TEXT DEFAULT 'estimated',
      price_status TEXT DEFAULT 'estimated',
      trust_score REAL DEFAULT 0.5,
      search_hits INTEGER NOT NULL DEFAULT 0,
      detail_views INTEGER NOT NULL DEFAULT 0,
      wrong_price_flags INTEGER NOT NULL DEFAULT 0,
      wrong_card_flags INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_card_search_collector
      ON card_search_cache(language_code, collector_number, printed_total);

    CREATE INDEX IF NOT EXISTS idx_card_search_hits
      ON card_search_cache(hit_count DESC, trust_score DESC);

    CREATE TABLE IF NOT EXISTS card_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      field TEXT NOT NULL,
      reported_value TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_card_corrections_slug
      ON card_corrections(slug, created_at DESC);

    CREATE TABLE IF NOT EXISTS query_card_hits (
      query_normalized TEXT NOT NULL,
      slug TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      last_hit_at TEXT NOT NULL,
      PRIMARY KEY (query_normalized, slug)
    );

    CREATE INDEX IF NOT EXISTS idx_query_card_hits
      ON query_card_hits(query_normalized, hit_count DESC);
  `);

  const columns = new Set(
    (db.prepare(`PRAGMA table_info(card_search_cache)`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  const migrations: Array<[string, string]> = [
    ["enriched_at", "TEXT"],
    ["identity_status", "TEXT DEFAULT 'estimated'"],
    ["price_status", "TEXT DEFAULT 'estimated'"],
    ["trust_score", "REAL DEFAULT 0.5"],
    ["search_hits", "INTEGER NOT NULL DEFAULT 0"],
    ["detail_views", "INTEGER NOT NULL DEFAULT 0"],
    ["wrong_price_flags", "INTEGER NOT NULL DEFAULT 0"],
    ["wrong_card_flags", "INTEGER NOT NULL DEFAULT 0"],
    ["search_blob", "TEXT"],
  ];

  for (const [name, definition] of migrations) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE card_search_cache ADD COLUMN ${name} ${definition}`);
    }
  }

  const correctionColumns = new Set(
    (db.prepare(`PRAGMA table_info(card_corrections)`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  const correctionMigrations: Array<[string, string]> = [
    ["correction_type", "TEXT"],
    ["parsed_json", "TEXT"],
    ["confidence", "TEXT"],
  ];

  for (const [name, definition] of correctionMigrations) {
    if (!correctionColumns.has(name)) {
      db.exec(`ALTER TABLE card_corrections ADD COLUMN ${name} ${definition}`);
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_card_search_blob ON card_search_cache(search_blob)`);
}

function getReadDatabase() {
  importSeedDataIfNeeded();

  const dbPath = getDatabasePath();

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  if (readDatabase) {
    return readDatabase;
  }

  try {
    readDatabase = new Database(dbPath, { readonly: true, fileMustExist: true });
    return readDatabase;
  } catch {
    return null;
  }
}

function withWriteDatabase<T>(runner: (db: Database.Database) => T): T | null {
  if (
    writeDatabaseUnavailable &&
    Date.now() - writeDatabaseUnavailableAt < WRITE_RETRY_MS
  ) {
    return null;
  }

  if (writeDatabaseUnavailable) {
    writeDatabaseUnavailable = false;
  }

  const dbPath = getDatabasePath();

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    ensureSchema(db);
    importSeedDataIntoDatabase(db);

    try {
      return runner(db);
    } finally {
      db.close();
      readDatabase = null;
    }
  } catch {
    writeDatabaseUnavailable = true;
    writeDatabaseUnavailableAt = Date.now();
    return null;
  }
}

function normalizeCollectorNumber(value: string) {
  return value.replace(/^0+(?=\d)/, "") || value;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchBlob(card: TcgCard) {
  return normalizeSearchText(
    [
      card.name,
      card.localizedName,
      card.englishName,
      card.setName,
      card.setLocalizedName,
      card.setEnglishName,
      card.setCode,
      card.collectorNumber,
      card.rarity,
      card.supertype,
      ...(card.types ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function rowToCard(row: CachedCardRow): TcgCard | null {
  try {
    return JSON.parse(row.card_json) as TcgCard;
  } catch {
    return null;
  }
}

function rowToMeta(row: CachedCardRow): CachedCardMeta {
  const identityStatus = (row.identity_status ?? "estimated") as FieldTrustStatus;
  const priceStatus = (row.price_status ?? "estimated") as FieldTrustStatus;

  return {
    slug: row.slug,
    searchHits: row.search_hits ?? row.hit_count ?? 0,
    detailViews: row.detail_views ?? 0,
    wrongPriceFlags: row.wrong_price_flags ?? 0,
    wrongCardFlags: row.wrong_card_flags ?? 0,
    trustScore: row.trust_score ?? 0.5,
    identityStatus,
    priceStatus,
    lastEnrichedAt: row.enriched_at,
    lastSearchedAt: row.last_searched_at,
    needsRefresh:
      isCacheStale(row.enriched_at ?? row.last_searched_at) ||
      (row.wrong_price_flags ?? 0) > 0 ||
      (row.wrong_card_flags ?? 0) > 0,
  };
}

function annotateCardWithMeta(card: TcgCard, meta: CachedCardMeta): TcgCard {
  const disputed = meta.wrongPriceFlags > 0 || meta.wrongCardFlags > 0;
  const identityStatus = meta.identityStatus;
  const priceStatus = disputed ? "disputed" : meta.priceStatus;
  const trustScore = meta.trustScore;

  return {
    ...card,
    sources: appendLearningSource(
      card.sources,
      meta.needsRefresh
        ? `Learned from ${meta.searchHits + meta.detailViews} prior lookups. Price data is stale and refreshing in the background.`
        : `Learned from ${meta.searchHits + meta.detailViews} prior lookups with trust score ${Math.round(trustScore * 100)}%.`,
      priceStatus === "disputed" ? "disputed" : meta.needsRefresh ? "stale" : identityStatus,
      trustScore,
    ),
  };
}

function scoreCardForQuery(
  card: TcgCard,
  query: string,
  meta: CachedCardMeta,
  queryAffinity = 0,
) {
  const normalizedQuery = normalizeSearchText(query);
  const haystack = buildSearchBlob(card);

  let score = meta.trustScore * 100 + queryAffinity * 15;

  if (normalizedQuery && haystack.includes(normalizedQuery)) {
    score += 50;
  }

  for (const token of normalizedQuery.split(" ").filter(Boolean)) {
    if (haystack.includes(token)) {
      score += 10;
    }
  }

  score += Math.min(25, meta.searchHits * 2);
  score -= Math.min(30, meta.wrongPriceFlags * 6 + meta.wrongCardFlags * 12);
  return score;
}

function recordQueryHit(db: Database.Database, query: string, slug: string) {
  const queryNormalized = normalizeSearchText(query);

  if (!queryNormalized || queryNormalized.length < 2) {
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO query_card_hits (query_normalized, slug, hit_count, last_hit_at)
     VALUES (@query, @slug, 1, @now)
     ON CONFLICT(query_normalized, slug) DO UPDATE SET
       hit_count = query_card_hits.hit_count + 1,
       last_hit_at = excluded.last_hit_at`,
  ).run({ query: queryNormalized, slug, now });
}

function upsertCardRow(
  db: Database.Database,
  card: TcgCard,
  query: string,
  context: "search" | "detail" | "refresh",
) {
  const now = new Date().toISOString();
  const cleanQuery = query.trim().slice(0, 256) || null;
  const searchBlob = buildSearchBlob(card);
  const identityStatus = deriveIdentityStatus(card);
  const priceStatus = derivePriceStatus(card, now);
  const existing = db
    .prepare(
      `SELECT search_hits, detail_views, wrong_price_flags, wrong_card_flags, hit_count
       FROM card_search_cache WHERE slug = ?`,
    )
    .get(card.slug) as
    | {
        search_hits: number;
        detail_views: number;
        wrong_price_flags: number;
        wrong_card_flags: number;
        hit_count: number;
      }
    | undefined;

  const searchHits = (existing?.search_hits ?? 0) + (context === "search" ? 1 : 0);
  const detailViews = (existing?.detail_views ?? 0) + (context === "detail" ? 1 : 0);
  const trustScore = computeTrustScore({
    searchHits,
    detailViews,
    wrongPriceFlags: existing?.wrong_price_flags ?? 0,
    wrongCardFlags: existing?.wrong_card_flags ?? 0,
    identityStatus,
    priceStatus,
  });

  db.prepare(
    `INSERT INTO card_search_cache (
      slug, language_code, collector_number, printed_total, card_json, query_text, search_blob,
      hit_count, last_searched_at, created_at, enriched_at, identity_status, price_status,
      trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags
    ) VALUES (
      @slug, @language_code, @collector_number, @printed_total, @card_json, @query_text, @search_blob,
      1, @now, @now, @now, @identity_status, @price_status,
      @trust_score, @search_hits, @detail_views, @wrong_price_flags, @wrong_card_flags
    )
    ON CONFLICT(slug) DO UPDATE SET
      card_json = excluded.card_json,
      query_text = COALESCE(excluded.query_text, card_search_cache.query_text),
      search_blob = excluded.search_blob,
      hit_count = card_search_cache.hit_count + 1,
      last_searched_at = excluded.last_searched_at,
      enriched_at = excluded.enriched_at,
      identity_status = excluded.identity_status,
      price_status = excluded.price_status,
      trust_score = excluded.trust_score,
      search_hits = excluded.search_hits,
      detail_views = excluded.detail_views`,
  ).run({
    slug: card.slug,
    language_code: card.language,
    collector_number: card.collectorNumber || null,
    printed_total: card.setPrintedTotal ?? card.setTotal ?? null,
    card_json: JSON.stringify(card),
    query_text: cleanQuery,
    search_blob: searchBlob,
    now,
    identity_status: identityStatus,
    price_status: priceStatus,
    trust_score: trustScore,
    search_hits: searchHits,
    detail_views: detailViews,
    wrong_price_flags: existing?.wrong_price_flags ?? 0,
    wrong_card_flags: existing?.wrong_card_flags ?? 0,
  });

  if (cleanQuery && context === "search") {
    recordQueryHit(db, cleanQuery, card.slug);
  }
}

export function importSeedDataIfNeeded() {
  if (seedImported) {
    return;
  }

  withWriteDatabase((db) => {
    importSeedDataIntoDatabase(db);
    return true;
  });

  seedImported = true;
}

function importSeedDataIntoDatabase(db: Database.Database) {
  const seedPath = getSeedPath();

  if (!fs.existsSync(seedPath)) {
    return;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(seedPath, "utf8")) as {
      cards?: TcgCard[];
    };

    for (const card of payload.cards ?? []) {
      if (!card?.slug) {
        continue;
      }

      const existing = db
        .prepare(`SELECT trust_score FROM card_search_cache WHERE slug = ?`)
        .get(card.slug) as { trust_score: number } | undefined;

      if (existing && (existing.trust_score ?? 0) > 0.55) {
        continue;
      }

      upsertCardRow(db, card, "community-seed", "search");
    }
  } catch {
    // Ignore malformed seed files.
  }
}

function backfillSearchBlob(db: Database.Database) {
  const rows = db
    .prepare(`SELECT slug, card_json FROM card_search_cache WHERE search_blob IS NULL OR search_blob = ''`)
    .all() as Array<{ slug: string; card_json: string }>;

  for (const row of rows) {
    try {
      const card = JSON.parse(row.card_json) as TcgCard;
      db.prepare(`UPDATE card_search_cache SET search_blob = ? WHERE slug = ?`).run(
        buildSearchBlob(card),
        row.slug,
      );
    } catch {
      continue;
    }
  }
}

export function lookupCachedCardBySlug(slug: string) {
  const db = getReadDatabase();

  if (!db) {
    return null;
  }

  const row = db.prepare(`SELECT ${CARD_SELECT} FROM card_search_cache WHERE slug = ?`).get(
    slug,
  ) as CachedCardRow | undefined;

  if (!row) {
    return null;
  }

  const card = rowToCard(row);

  if (!card) {
    return null;
  }

  const meta = rowToMeta(row);
  return { card: annotateCardWithMeta(card, meta), meta };
}

export function lookupCachedCardsByCollectorCode(
  language: CardLanguageCode | "all",
  collectorCode: CollectorLookup,
): TcgCard[] {
  const db = getReadDatabase();

  if (!db) {
    return [];
  }

  const normalizedNumber = normalizeCollectorNumber(collectorCode.number);
  const sql = collectorCode.printedTotal
    ? `SELECT ${CARD_SELECT}
       FROM card_search_cache
       WHERE collector_number IS NOT NULL
         AND (collector_number = @number OR collector_number = @padded OR collector_number = @raw)
         AND printed_total = @printedTotal
       ORDER BY trust_score DESC, hit_count DESC
       LIMIT 24`
    : `SELECT ${CARD_SELECT}
       FROM card_search_cache
       WHERE collector_number IS NOT NULL
         AND (collector_number = @number OR collector_number = @padded OR collector_number = @raw)
       ORDER BY trust_score DESC, hit_count DESC
       LIMIT 24`;

  const rows = db.prepare(sql).all({
    number: normalizedNumber,
    padded: normalizedNumber.padStart(3, "0"),
    raw: collectorCode.number,
    printedTotal: collectorCode.printedTotal ?? null,
  }) as CachedCardRow[];

  const seen = new Set<string>();

  return rows
    .filter((row) => language === "all" || row.language_code === language)
    .map((row) => {
      const card = rowToCard(row);
      if (!card) {
        return null;
      }

      return annotateCardWithMeta(card, rowToMeta(row));
    })
    .filter((card): card is TcgCard => {
      if (!card || seen.has(card.slug)) {
        return false;
      }

      seen.add(card.slug);
      return true;
    });
}

export function lookupCachedCardsByQuery(
  query: string,
  language: CardLanguageCode | "all",
  limit = 12,
): Array<{ card: TcgCard; score: number; meta: CachedCardMeta }> {
  const db = getReadDatabase();
  const normalizedQuery = normalizeSearchText(query);

  if (!db || normalizedQuery.length < 2) {
    return [];
  }

  const terms = normalizedQuery.split(" ").filter(Boolean);
  const affinityBySlug = new Map<string, number>();

  const affinityRows = db
    .prepare(
      `SELECT slug, hit_count FROM query_card_hits
       WHERE query_normalized = ?
       ORDER BY hit_count DESC
       LIMIT ?`,
    )
    .all(normalizedQuery, limit * 3) as Array<{ slug: string; hit_count: number }>;

  for (const row of affinityRows) {
    affinityBySlug.set(row.slug, row.hit_count);
  }

  const blobClauses = terms.map(() => "search_blob LIKE ?").join(" AND ");
  const blobParams = terms.map((term) => `%${term}%`);
  const languageClause = language === "all" ? "" : "AND language_code = ?";
  const params: Array<string | number> = [...blobParams];

  if (language !== "all") {
    params.push(language);
  }

  params.push(limit * 4);

  const blobRows =
    terms.length > 0
      ? (db
          .prepare(
            `SELECT ${CARD_SELECT}
             FROM card_search_cache
             WHERE search_blob IS NOT NULL
               AND ${blobClauses}
               ${languageClause}
             ORDER BY trust_score DESC, hit_count DESC
             LIMIT ?`,
          )
          .all(...params) as CachedCardRow[])
      : [];

  const slugOrder = [
    ...affinityRows.map((row) => row.slug),
    ...blobRows.map((row) => row.slug),
  ];
  const uniqueSlugs = [...new Set(slugOrder)].slice(0, limit * 3);

  if (!uniqueSlugs.length) {
    return [];
  }

  const placeholders = uniqueSlugs.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT ${CARD_SELECT} FROM card_search_cache WHERE slug IN (${placeholders})`)
    .all(...uniqueSlugs) as CachedCardRow[];

  return rows
    .map((row) => {
      const card = rowToCard(row);
      if (!card) {
        return null;
      }

      if (language !== "all" && row.language_code !== language) {
        return null;
      }

      const meta = rowToMeta(row);
      const score = scoreCardForQuery(
        card,
        query,
        meta,
        affinityBySlug.get(row.slug) ?? 0,
      );

      if (score < 40) {
        return null;
      }

      return {
        card: annotateCardWithMeta(card, meta),
        score,
        meta,
      };
    })
    .filter((item): item is { card: TcgCard; score: number; meta: CachedCardMeta } => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function persistCard(
  card: TcgCard,
  options: { query?: string; context?: "search" | "detail" | "refresh" } = {},
) {
  if (!card.slug?.trim() || !card.id?.trim()) {
    return;
  }

  withWriteDatabase((db) => {
    backfillSearchBlob(db);
    upsertCardRow(db, card, options.query ?? "", options.context ?? "detail");
    return true;
  });

  void import("./card-cache-sync.server").then(({ syncCardToRemoteCache }) =>
    syncCardToRemoteCache(card).catch(() => undefined),
  );
}

export function persistSearchResultCards(cards: TcgCard[], query = "") {
  for (const card of cards) {
    persistCard(card, { query, context: "search" });
  }
}

export function recordCardCorrection(input: {
  slug: string;
  field: "price" | "identity";
  issueType?: string;
  reportedValue?: string;
  note?: string;
  parsed?: ParsedCardFeedback;
}) {
  withWriteDatabase((db) => {
    const trustPenalty =
      input.parsed?.confidence === "high" ? 0.08 : input.parsed?.confidence === "medium" ? 0.06 : 0.04;

    db.prepare(
      `INSERT INTO card_corrections (
         slug, field, reported_value, note, created_at, correction_type, parsed_json, confidence
       )
       VALUES (
         @slug, @field, @reported_value, @note, @created_at, @correction_type, @parsed_json, @confidence
       )`,
    ).run({
      slug: input.slug,
      field: input.field,
      reported_value: input.reportedValue ?? null,
      note: input.note ?? null,
      created_at: new Date().toISOString(),
      correction_type: input.issueType ?? input.parsed?.issueType ?? null,
      parsed_json: input.parsed ? JSON.stringify(input.parsed) : null,
      confidence: input.parsed?.confidence ?? null,
    });

    const column = input.field === "price" ? "wrong_price_flags" : "wrong_card_flags";
    db.prepare(
      `UPDATE card_search_cache
       SET ${column} = COALESCE(${column}, 0) + 1,
           price_status = CASE WHEN @field = 'price' THEN 'disputed' ELSE price_status END,
           identity_status = CASE WHEN @field = 'identity' THEN 'disputed' ELSE identity_status END,
           trust_score = MAX(0.05, COALESCE(trust_score, 0.5) - @trust_penalty)
       WHERE slug = @slug`,
    ).run({ slug: input.slug, field: input.field, trust_penalty: trustPenalty });

    return true;
  });
}

export function listCardCorrections(slug: string, limit = 20) {
  const db = getReadDatabase();

  if (!db) {
    return [];
  }

  return db
    .prepare(
      `SELECT id, slug, field, reported_value, note, created_at
       FROM card_corrections
       WHERE slug = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(slug, limit) as Array<{
    id: number;
    slug: string;
    field: string;
    reported_value: string | null;
    note: string | null;
    created_at: string;
  }>;
}

export function listCardsNeedingRefresh(limit = 20) {
  const db = getReadDatabase();

  if (!db) {
    return [] as string[];
  }

  const rows = db
    .prepare(
      `SELECT slug FROM card_search_cache
       WHERE wrong_price_flags > 0
          OR wrong_card_flags > 0
          OR enriched_at IS NULL
          OR datetime(enriched_at) < datetime('now', '-7 days')
       ORDER BY wrong_price_flags + wrong_card_flags DESC, hit_count DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ slug: string }>;

  return rows.map((row) => row.slug);
}

export function shouldRefreshCachedCard(meta: CachedCardMeta | null | undefined) {
  return Boolean(meta?.needsRefresh);
}
