#!/usr/bin/env node
/**
 * Best-effort: apply Clerk account RLS policies during build/deploy so the
 * Vercel pooler role can read users/settings after sign-in. Skips when no
 * DATABASE_URL is set, and never fails the build.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const url =
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL?.trim();

if (!url) {
  console.log("ensure-account-policies: no DATABASE_URL, skipping");
  process.exit(0);
}

const sqlFile = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle", "0012_account_table_server_policies.sql");
const ddl = readFileSync(sqlFile, "utf8");
const supabase = /supabase\.(co|com)|pooler\.supabase/i.test(url);

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  ssl: supabase ? "require" : undefined,
});

try {
  await sql.unsafe(ddl);
  console.log("ensure-account-policies: applied server_account_all policies");
} catch (error) {
  console.warn(
    "ensure-account-policies: skipped (",
    error instanceof Error ? error.message : error,
    ")",
  );
} finally {
  await sql.end({ timeout: 5 });
}
