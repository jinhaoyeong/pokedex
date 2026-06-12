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
  query_hit_count?: number | null;
  query_last_seen_at?: string | null;
  query_match_type?: "exact" | "related" | null;
};

let readDatabase: Database.Database | null = null;
let writeDatabaseUnavailable = false;
let seedImported = false;
const CACHE_LEARNING_RECENCY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

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

    CREATE TABLE IF NOT EXISTS card_query_learning (
      normalized_query TEXT NOT NULL,
      slug TEXT NOT NULL,
      language_code TEXT NOT NULL,
      query_text TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (normalized_query, slug)
    );

    CREATE INDEX IF NOT EXISTS idx_card_query_learning_query
      ON card_query_learning(normalized_query, hit_count DESC, last_seen_at DESC);

    CREATE INDEX IF NOT EXISTS idx_card_query_learning_slug
      ON card_query_learning(slug, hit_count DESC);

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
  ];

  for (const [name, definition] of migrations) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE card_search_cache ADD COLUMN ${name} ${definition}`);
    }
  }
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
  if (writeDatabaseUnavailable) {
    return null;
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
    needsRefresh: isCacheStale(row.enriched_at ?? row.last_searched_at),
  };
}

function annotateCardWithMeta(card: TcgCard, meta: CachedCardMeta): TcgCard {
  const disputed = meta.wrongPriceFlags > 0 || meta.wrongCardFlags > 0;
  const identityStatus = deriveIdentityStatus(card);
  const priceStatus = derivePriceStatus(card, meta.lastEnrichedAt, disputed);
  const trustScore = computeTrustScore({
    searchHits: meta.searchHits,
    detailViews: meta.detailViews,
    wrongPriceFlags: meta.wrongPriceFlags,
    wrongCardFlags: meta.wrongCardFlags,
    identityStatus,
    priceStatus,
  });

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

function scoreCardForQuery(card: TcgCard, query: string, meta: CachedCardMeta) {
  const normalizedQuery = normalizeSearchText(query);
  const haystack = normalizeSearchText(
    [card.name, card.localizedName, card.englishName, card.setName, card.setCode, card.collectorNumber]
      .filter(Boolean)
      .join(" "),
  );

  let score = meta.trustScore * 100;

  if (meta.wrongCardFlags > 0) {
    score -= Math.min(35, meta.wrongCardFlags * 12);
  }

  if (meta.priceStatus === "disputed") {
    score -= 8;
  }

  if (normalizedQuery && haystack.includes(normalizedQuery)) {
    score += 40;
  }

  if (normalizedQuery && haystack.startsWith(normalizedQuery)) {
    score += 18;
  }

  if (normalizedQuery && normalizeSearchText(card.collectorNumber) === normalizedQuery) {
    score += 28;
  }

  for (const token of normalizedQuery.split(" ").filter(Boolean)) {
    if (haystack.includes(token)) {
      score += 8;
    }
  }

  score += Math.min(20, meta.searchHits * 2);
  return score;
}

function upsertQueryLearning(
  db: Database.Database,
  card: TcgCard,
  query: string | null,
  now: string,
) {
  if (!query) {
    return;
  }

  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery.length < 2) {
    return;
  }

  db.prepare(
    `INSERT INTO card_query_learning (
      normalized_query, slug, language_code, query_text, hit_count, first_seen_at, last_seen_at
    ) VALUES (
      @normalized_query, @slug, @language_code, @query_text, 1, @now, @now
    )
    ON CONFLICT(normalized_query, slug) DO UPDATE SET
      language_code = excluded.language_code,
      query_text = excluded.query_text,
      hit_count = card_query_learning.hit_count + 1,
      last_seen_at = excluded.last_seen_at`,
  ).run({
    normalized_query: normalizedQuery,
    slug: card.slug,
    language_code: card.language,
    query_text: query,
    now,
  });
}

function upsertCardRow(
  db: Database.Database,
  card: TcgCard,
  query: string,
  context: "search" | "detail" | "refresh",
) {
  const now = new Date().toISOString();
  const cleanQuery = query.trim().slice(0, 256) || null;
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
      slug, language_code, collector_number, printed_total, card_json, query_text,
      hit_count, last_searched_at, created_at, enriched_at, identity_status, price_status,
      trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags
    ) VALUES (
      @slug, @language_code, @collector_number, @printed_total, @card_json, @query_text,
      1, @now, @now, @now, @identity_status, @price_status,
      @trust_score, @search_hits, @detail_views, @wrong_price_flags, @wrong_card_flags
    )
    ON CONFLICT(slug) DO UPDATE SET
      card_json = excluded.card_json,
      query_text = COALESCE(excluded.query_text, card_search_cache.query_text),
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
    now,
    identity_status: identityStatus,
    price_status: priceStatus,
    trust_score: trustScore,
    search_hits: searchHits,
    detail_views: detailViews,
    wrong_price_flags: existing?.wrong_price_flags ?? 0,
    wrong_card_flags: existing?.wrong_card_flags ?? 0,
  });

  if (context === "search") {
    upsertQueryLearning(db, card, cleanQuery, now);
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

  const count = db.prepare(`SELECT COUNT(*) as count FROM card_search_cache`).get() as {
    count: number;
  };

  if (count.count > 0) {
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

      upsertCardRow(db, card, "community-seed", "search");
    }
  } catch {
    // Ignore malformed seed files.
  }
}

export function lookupCachedCardBySlug(slug: string) {
  const db = getReadDatabase();

  if (!db) {
    return null;
  }

  const row = db
    .prepare(
      `SELECT slug, language_code, collector_number, printed_total, card_json, query_text,
              hit_count, last_searched_at, enriched_at, identity_status, price_status,
              trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags
       FROM card_search_cache WHERE slug = ?`,
    )
    .get(slug) as CachedCardRow | undefined;

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
  const rows = db
    .prepare(
      `SELECT slug, language_code, collector_number, printed_total, card_json, query_text,
              hit_count, last_searched_at, enriched_at, identity_status, price_status,
              trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags
       FROM card_search_cache
       WHERE collector_number IS NOT NULL
         AND (collector_number = @number OR collector_number = @padded OR collector_number = @raw)
       ORDER BY trust_score DESC, hit_count DESC, last_searched_at DESC
       LIMIT 24`,
    )
    .all({
      number: normalizedNumber,
      padded: normalizedNumber.padStart(3, "0"),
      raw: collectorCode.number,
    }) as CachedCardRow[];

  const seen = new Set<string>();

  return rows
    .filter((row) => {
      if (language !== "all" && row.language_code !== language) {
        return false;
      }

      if (!row.collector_number) {
        return false;
      }

      const rowNumber = normalizeCollectorNumber(row.collector_number);
      const targetNumber = normalizeCollectorNumber(collectorCode.number);

      if (rowNumber !== targetNumber) {
        return false;
      }

      if (collectorCode.printedTotal == null) {
        return true;
      }

      return row.printed_total === collectorCode.printedTotal;
    })
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

  const learnedRows = db
    .prepare(
      `SELECT c.slug, c.language_code, c.collector_number, c.printed_total, c.card_json, c.query_text,
              c.hit_count, c.last_searched_at, c.enriched_at, c.identity_status, c.price_status,
              c.trust_score, c.search_hits, c.detail_views, c.wrong_price_flags, c.wrong_card_flags,
              q.hit_count AS query_hit_count, q.last_seen_at AS query_last_seen_at,
              CASE WHEN q.normalized_query = @normalized_query THEN 'exact' ELSE 'related' END AS query_match_type
       FROM card_query_learning q
       JOIN card_search_cache c ON c.slug = q.slug
       WHERE q.normalized_query = @normalized_query
          OR q.normalized_query LIKE @prefix_query
          OR @normalized_query LIKE q.normalized_query || '%'
       ORDER BY
         CASE WHEN q.normalized_query = @normalized_query THEN 0 ELSE 1 END,
         q.hit_count DESC,
         c.trust_score DESC
       LIMIT 180`,
    )
    .all({
      normalized_query: normalizedQuery,
      prefix_query: `${normalizedQuery}%`,
    }) as CachedCardRow[];

  const fallbackRows = db
    .prepare(
      `SELECT slug, language_code, collector_number, printed_total, card_json, query_text,
              hit_count, last_searched_at, enriched_at, identity_status, price_status,
              trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags
       FROM card_search_cache
       ORDER BY trust_score DESC, hit_count DESC
       LIMIT 160`,
    )
    .all() as CachedCardRow[];

  const rowsBySlug = new Map<string, CachedCardRow>();

  for (const row of [...learnedRows, ...fallbackRows]) {
    if (!rowsBySlug.has(row.slug)) {
      rowsBySlug.set(row.slug, row);
    }
  }

  return [...rowsBySlug.values()]
    .map((row) => {
      const card = rowToCard(row);
      if (!card) {
        return null;
      }

      if (language !== "all" && row.language_code !== language) {
        return null;
      }

      const meta = rowToMeta(row);
      let score = scoreCardForQuery(card, query, meta);

      if (row.query_hit_count) {
        score += Math.min(45, row.query_hit_count * 6);
      }

      if (row.query_match_type === "exact") {
        score += 35;
      } else if (row.query_match_type === "related") {
        score += 14;
      }

      if (row.query_last_seen_at) {
        const queryLastSeenAt = Date.parse(row.query_last_seen_at);
        if (
          Number.isFinite(queryLastSeenAt) &&
          Date.now() - queryLastSeenAt <= CACHE_LEARNING_RECENCY_GRACE_MS
        ) {
          score += 8;
        }
      }

      if (score < 45) {
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
  reportedValue?: string;
  note?: string;
}) {
  withWriteDatabase((db) => {
    db.prepare(
      `INSERT INTO card_corrections (slug, field, reported_value, note, created_at)
       VALUES (@slug, @field, @reported_value, @note, @created_at)`,
    ).run({
      slug: input.slug,
      field: input.field,
      reported_value: input.reportedValue ?? null,
      note: input.note ?? null,
      created_at: new Date().toISOString(),
    });

    const column = input.field === "price" ? "wrong_price_flags" : "wrong_card_flags";
    db.prepare(
      `UPDATE card_search_cache
       SET ${column} = COALESCE(${column}, 0) + 1,
           price_status = CASE WHEN @field = 'price' THEN 'disputed' ELSE price_status END,
           trust_score = MAX(0.05, COALESCE(trust_score, 0.5) - 0.08)
       WHERE slug = @slug`,
    ).run({ slug: input.slug, field: input.field });

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

export function listPopularCachedCards(limit = 50) {
  const db = getReadDatabase();

  if (!db) {
    return [] as TcgCard[];
  }

  const rows = db
    .prepare(
      `SELECT card_json FROM card_search_cache
       ORDER BY hit_count DESC, trust_score DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ card_json: string }>;

  return rows
    .map((row) => {
      try {
        return JSON.parse(row.card_json) as TcgCard;
      } catch {
        return null;
      }
    })
    .filter((card): card is TcgCard => Boolean(card?.slug));
}

export function shouldRefreshCachedCard(meta: CachedCardMeta | null | undefined) {
  return Boolean(meta?.needsRefresh);
}
