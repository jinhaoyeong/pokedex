import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildPostgresOptions, resolveDatabaseUrl } from "./connection-options";
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
  const url = resolveDatabaseUrl();

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase connection string to the environment to enable portfolio features.",
    );
  }

  // connect_timeout is short on non-Supabase hosts: cache-style reads sit in
  // hot paths and postgres-js's 30s default turns an unreachable database
  // into a full route timeout. Supabase pooler gets a longer handshake window.
  //
  // Pool size: the database is now the primary search/catalog store, so a
  // single connection serializes every concurrent request. Keep the pool modest
  // on serverless (many instances share Supabase's pooler) but wide enough that
  // one slow query can't stall the whole app.
  const client = postgres(url, buildPostgresOptions(url));

  return drizzle(client, { schema });
}

export function isDatabaseConfigured() {
  return Boolean(resolveDatabaseUrl());
}

export function getDb(): Database {
  if (!globalForDb.__pokedexDb) {
    globalForDb.__pokedexDb = createDb();
  }

  return globalForDb.__pokedexDb;
}

export function resetDb() {
  const existing = globalForDb.__pokedexDb;
  globalForDb.__pokedexDb = undefined;

  if (existing) {
    void existing.$client.end({ timeout: 1 }).catch(() => undefined);
  }
}
