#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import nextEnv from "@next/env";
import Database from "better-sqlite3";
import postgres from "postgres";

const ROOT = process.cwd();
const { loadEnvConfig } = nextEnv;
loadEnvConfig(ROOT);

const DATA_DIR = path.join(ROOT, "data");
const BATCH_SIZE = Number(process.env.SEED_SUPABASE_BATCH_SIZE ?? "500");
const DATABASE_URL = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!DATABASE_URL) {
  console.error("Missing DIRECT_URL or DATABASE_URL. Use the direct Supabase URL for seeding.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
});

function existingPath(...parts) {
  const filePath = path.join(...parts);
  return fs.existsSync(filePath) ? filePath : null;
}

function readJson(filePath, fallback) {
  if (!filePath) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Skipping malformed JSON seed: ${filePath}`, error.message);
    return fallback;
  }
}

function parseJson(value, fallback, label) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(`Skipping malformed cached JSON for ${label}:`, error.message);
    return fallback;
  }
}

function asIso(value) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchText(card) {
  return normalizeText(
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

function releaseYear(card) {
  const release = card.releaseDate ?? card.setReleaseDate ?? "";
  const match = String(release).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function marketPrice(card) {
  const value = Number(card.marketPriceUsd ?? card.priceConsensus?.finalEstimateUsd ?? 0);
  return Number.isFinite(value) && value > 0 ? value.toFixed(2) : null;
}

function catalogRowFromCard(card) {
  if (!card?.slug || !card?.id) {
    return null;
  }

  return {
    slug: card.slug,
    card_id: card.id,
    language_code: card.language ?? "en",
    set_id: card.setId ?? card.setCode ?? "",
    set_code: card.setCode ?? card.setId ?? "",
    collector_number: card.collectorNumber ?? "",
    printed_total: card.setPrintedTotal ?? card.setTotal ?? null,
    name: card.name ?? card.englishName ?? card.localizedName ?? card.slug,
    english_name: card.englishName ?? null,
    localized_name: card.localizedName ?? null,
    rarity: card.rarity ?? null,
    supertype: card.supertype ?? null,
    image_url: card.image ?? null,
    release_year: releaseYear(card),
    search_text: buildSearchText(card),
    market_price_usd: marketPrice(card),
    card_json: card,
  };
}

async function upsertCardsCatalog(rows) {
  if (!rows.length) {
    return;
  }

  await sql`
    insert into cards_catalog ${sql(rows)}
    on conflict (slug) do update set
      card_id = excluded.card_id,
      language_code = excluded.language_code,
      set_id = excluded.set_id,
      set_code = excluded.set_code,
      collector_number = excluded.collector_number,
      printed_total = excluded.printed_total,
      name = excluded.name,
      english_name = excluded.english_name,
      localized_name = excluded.localized_name,
      rarity = excluded.rarity,
      supertype = excluded.supertype,
      image_url = excluded.image_url,
      release_year = excluded.release_year,
      search_text = excluded.search_text,
      market_price_usd = excluded.market_price_usd,
      card_json = excluded.card_json,
      updated_at = now()
  `;
}

async function upsertLearningRows(rows) {
  if (!rows.length) {
    return;
  }

  await sql`
    insert into card_learning_cache ${sql(rows)}
    on conflict (slug) do update set
      language_code = excluded.language_code,
      collector_number = excluded.collector_number,
      printed_total = excluded.printed_total,
      card_json = excluded.card_json,
      query_text = coalesce(excluded.query_text, card_learning_cache.query_text),
      search_blob = excluded.search_blob,
      hit_count = greatest(card_learning_cache.hit_count, excluded.hit_count),
      last_searched_at = greatest(card_learning_cache.last_searched_at, excluded.last_searched_at),
      enriched_at = coalesce(excluded.enriched_at, card_learning_cache.enriched_at),
      identity_status = excluded.identity_status,
      price_status = excluded.price_status,
      trust_score = greatest(card_learning_cache.trust_score, excluded.trust_score),
      search_hits = greatest(card_learning_cache.search_hits, excluded.search_hits),
      detail_views = greatest(card_learning_cache.detail_views, excluded.detail_views),
      wrong_price_flags = greatest(card_learning_cache.wrong_price_flags, excluded.wrong_price_flags),
      wrong_card_flags = greatest(card_learning_cache.wrong_card_flags, excluded.wrong_card_flags),
      updated_at = now()
  `;
}

async function upsertCorrections(rows) {
  if (!rows.length) {
    return;
  }

  await sql`
    insert into card_corrections ${sql(rows)}
    on conflict (slug, field, reported_value, correction_type, created_at) do nothing
  `;
}

async function upsertQueryHits(rows) {
  if (!rows.length) {
    return;
  }

  await sql`
    insert into query_card_hits ${sql(rows)}
    on conflict (query_normalized, slug) do update set
      hit_count = greatest(query_card_hits.hit_count, excluded.hit_count),
      last_hit_at = greatest(query_card_hits.last_hit_at, excluded.last_hit_at)
  `;
}

async function upsertSearchResponses(rows) {
  if (!rows.length) {
    return;
  }

  await sql`
    insert into search_responses ${sql(rows)}
    on conflict (key) do update set
      query = excluded.query,
      set_filter = excluded.set_filter,
      page = excluded.page,
      language = excluded.language,
      sort = excluded.sort,
      response_json = excluded.response_json,
      result_count = excluded.result_count,
      fetched_at = excluded.fetched_at,
      updated_at = now()
  `;
}

async function flush(label, rows, upsert) {
  let count = 0;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    await upsert(batch);
    count += batch.length;
    process.stdout.write(`\r${label}: ${count.toLocaleString()} rows`);
  }

  if (rows.length) {
    process.stdout.write("\n");
  }
}

function readCardsIndexRows() {
  const dbPath = existingPath(DATA_DIR, "pokemon-cards-index.sqlite");
  if (!dbPath) {
    return [];
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("select * from cards_index").all();
  } finally {
    db.close();
  }
}

function catalogRowFromIndex(row) {
  return {
    slug: row.slug,
    card_id: row.card_id,
    language_code: row.language_code,
    set_id: row.set_id,
    set_code: row.set_code,
    collector_number: row.collector_number,
    printed_total: row.printed_total ?? null,
    name: row.name,
    english_name: row.english_name ?? null,
    localized_name: row.localized_name ?? null,
    rarity: row.rarity ?? null,
    supertype: row.supertype ?? null,
    image_url: row.image_url ?? null,
    release_year: row.release_year ?? null,
    search_text: row.search_text ?? "",
    market_price_usd: null,
    card_json: null,
  };
}

function readLearningCache() {
  const dbPath = existingPath(DATA_DIR, "pokemon-cards-cache.sqlite");
  if (!dbPath) {
    return { cards: [], corrections: [], hits: [] };
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const cards = db
      .prepare(
        `select slug, language_code, collector_number, printed_total, card_json, query_text,
          search_blob, hit_count, last_searched_at, enriched_at, identity_status, price_status,
          trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags
         from card_search_cache`,
      )
      .all()
      .flatMap((row) => {
        const cardJson = parseJson(row.card_json, null, `card_search_cache:${row.slug}`);
        if (!cardJson) {
          return [];
        }

        return [
          {
            slug: row.slug,
            language_code: row.language_code,
            collector_number: row.collector_number,
            printed_total: row.printed_total,
            card_json: cardJson,
            query_text: row.query_text,
            search_blob: row.search_blob,
            hit_count: row.hit_count ?? 1,
            last_searched_at: asIso(row.last_searched_at),
            enriched_at: row.enriched_at ? asIso(row.enriched_at) : null,
            identity_status: row.identity_status ?? "estimated",
            price_status: row.price_status ?? "estimated",
            trust_score: String(row.trust_score ?? 0.5),
            search_hits: row.search_hits ?? 0,
            detail_views: row.detail_views ?? 0,
            wrong_price_flags: row.wrong_price_flags ?? 0,
            wrong_card_flags: row.wrong_card_flags ?? 0,
          },
        ];
      });
    const corrections = db
      .prepare(
        `select slug, field, reported_value, note, correction_type, parsed_json, confidence, created_at
         from card_corrections`,
      )
      .all()
      .map((row) => ({
        slug: row.slug,
        field: row.field,
        reported_value: row.reported_value,
        note: row.note,
        correction_type: row.correction_type,
        parsed_json: parseJson(row.parsed_json, null, `card_corrections:${row.slug}`),
        confidence: row.confidence,
        created_at: asIso(row.created_at),
      }));
    const hits = db
      .prepare(`select query_normalized, slug, hit_count, last_hit_at from query_card_hits`)
      .all()
      .map((row) => ({
        query_normalized: row.query_normalized,
        slug: row.slug,
        hit_count: row.hit_count ?? 1,
        last_hit_at: asIso(row.last_hit_at),
      }));

    return { cards, corrections, hits };
  } finally {
    db.close();
  }
}

function readSearchCache() {
  const dbPath = existingPath(DATA_DIR, "pokemon-search-cache.sqlite");
  if (!dbPath) {
    return [];
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        `select key, query, set_filter, page, language, sort, response_json, result_count, fetched_at, updated_at
         from search_cache`,
      )
      .all()
      .flatMap((row) => {
        const responseJson = parseJson(row.response_json, null, `search_cache:${row.key}`);
        if (!responseJson) {
          return [];
        }

        return [
          {
            key: row.key,
            query: row.query ?? "",
            set_filter: row.set_filter ?? "",
            page: row.page ?? 1,
            language: row.language ?? "all",
            sort: row.sort ?? "relevance",
            response_json: responseJson,
            result_count: row.result_count ?? 0,
            fetched_at: asIso(row.fetched_at),
            updated_at: asIso(row.updated_at),
          },
        ];
      });
  } finally {
    db.close();
  }
}

async function main() {
  const catalogBySlug = new Map();

  for (const row of readCardsIndexRows()) {
    const catalog = catalogRowFromIndex(row);
    if (catalog.slug) {
      catalogBySlug.set(catalog.slug, catalog);
    }
  }

  const seedCards = readJson(existingPath(DATA_DIR, "pokemon-cards-seed.json"), {}).cards ?? [];
  for (const card of seedCards) {
    const catalog = catalogRowFromCard(card);
    if (catalog) {
      catalogBySlug.set(catalog.slug, { ...(catalogBySlug.get(catalog.slug) ?? {}), ...catalog });
    }
  }

  const learning = readLearningCache();
  for (const row of learning.cards) {
    const catalog = catalogRowFromCard(row.card_json);
    if (catalog) {
      catalogBySlug.set(catalog.slug, { ...(catalogBySlug.get(catalog.slug) ?? {}), ...catalog });
    }
  }

  await sql`create extension if not exists pg_trgm`;
  await flush("cards_catalog", [...catalogBySlug.values()], upsertCardsCatalog);
  await flush("card_learning_cache", learning.cards, upsertLearningRows);
  await flush("card_corrections", learning.corrections, upsertCorrections);
  await flush("query_card_hits", learning.hits, upsertQueryHits);
  await flush("search_responses", readSearchCache(), upsertSearchResponses);
}

main()
  .then(async () => {
    await sql.end();
    console.log("Supabase catalog seed complete.");
  })
  .catch(async (error) => {
    await sql.end({ timeout: 5 });
    console.error(error);
    process.exit(1);
  });
