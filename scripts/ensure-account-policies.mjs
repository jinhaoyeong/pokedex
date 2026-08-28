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

function isPooled(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().includes("pooler.supabase") || parsed.port === "6543";
  } catch {
    return false;
  }
}

const direct = process.env.DIRECT_URL?.trim();
const pooledCandidates = [
  process.env.POSTGRES_URL,
  process.env.DATABASE_URL,
  process.env.POSTGRES_PRISMA_URL,
]
  .map((value) => value?.trim())
  .filter(Boolean);

const url = direct || pooledCandidates.find((value) => isPooled(value)) || pooledCandidates[0];

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
