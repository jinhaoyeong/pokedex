import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Lazy Drizzle client for the Supabase Postgres database.
 *
 * The connection is only created on first use so the app (including all
 * public pricing APIs and static builds) keeps working when DATABASE_URL is
 * not configured. `prepare: false` and a small pool keep the client
 * compatible with Supabase's transaction-mode pooler on serverless.
 */

type Database = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { __pokedexDb?: Database };

function createDb() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase connection string to the environment to enable portfolio features.",
    );
  }

  // connect_timeout is deliberately short: cache-style reads sit in hot paths
  // (search overlay, card detail) and postgres-js's 30s default turns an
  // unreachable database into a full route timeout instead of a cache miss.
  //
  // Pool size: the database is now the primary search/catalog store, so a
  // single connection serializes every concurrent request (five parallel
  // search-sets calls alone were queueing for 80s+). Keep the pool modest on
  // serverless (many instances share Supabase's pooler) but wide enough that
  // one slow query can't stall the whole app.
  const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  const client = postgres(url, {
    prepare: false,
    max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
    idle_timeout: 30,
    connect_timeout: 5,
  });

  return drizzle(client, { schema });
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb(): Database {
  if (!globalForDb.__pokedexDb) {
    globalForDb.__pokedexDb = createDb();
  }

  return globalForDb.__pokedexDb;
}
