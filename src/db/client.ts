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
  const client = postgres(url, { prepare: false, max: 1, connect_timeout: 5 });

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
