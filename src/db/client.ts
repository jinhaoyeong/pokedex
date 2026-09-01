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
 * compatible with Supabase's transaction-mode pooler (port 6543). Session-mode
 * URLs (port 5432) are rewritten so Next.js cannot exhaust pool_size: 15.
 */

type Database = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as {
  __pokedexDb?: Database;
  __pokedexDbUrl?: string;
};

function createDb(url: string) {
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
  const url = resolveDatabaseUrl();

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase connection string to the environment to enable portfolio features.",
    );
  }

  if (!globalForDb.__pokedexDb || globalForDb.__pokedexDbUrl !== url) {
    if (globalForDb.__pokedexDb) {
      void globalForDb.__pokedexDb.$client.end({ timeout: 1 }).catch(() => undefined);
    }
    globalForDb.__pokedexDb = createDb(url);
    globalForDb.__pokedexDbUrl = url;
  }

  return globalForDb.__pokedexDb;
}

export function resetDb() {
  const existing = globalForDb.__pokedexDb;
  globalForDb.__pokedexDb = undefined;
  globalForDb.__pokedexDbUrl = undefined;

  if (existing) {
    void existing.$client.end({ timeout: 1 }).catch(() => undefined);
  }
}
