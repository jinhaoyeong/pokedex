#!/usr/bin/env node
/**
 * Best-effort: apply Clerk account RLS policies during build/deploy so the
 * Vercel pooler role can read users/settings after sign-in. Skips when no
 * DATABASE_URL is set, and never fails the build.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = pkg;

loadEnvConfig(process.cwd());

function isPooled(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().includes("pooler.supabase") || parsed.port === "6543";
  } catch {
    return false;
  }
}

function projectRefFromValue(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const hosted = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    if (hosted) {
      return hosted[1];
    }
    const dbHost = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (dbHost) {
      return dbHost[1];
    }
    const userRef = decodeURIComponent(parsed.username).match(/^postgres\.([a-z0-9]+)$/i);
    if (userRef) {
      return userRef[1];
    }
  } catch {
    const hosted = String(value).match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
    if (hosted) {
      return hosted[1];
    }
  }

  return null;
}

function poolerRegionFromEnv() {
  const explicit = process.env.SUPABASE_REGION?.trim().replace(/^aws-(?:\d+-)?/, "");
  if (explicit) {
    return explicit;
  }

  const vercelMap = {
    sin1: "ap-southeast-1",
    syd1: "ap-southeast-2",
    hnd1: "ap-northeast-1",
    iad1: "us-east-1",
    sfo1: "us-west-1",
    lhr1: "eu-west-2",
    fra1: "eu-central-1",
  };
  const vercelRegion = process.env.VERCEL_REGION?.trim().toLowerCase();
  return vercelRegion ? vercelMap[vercelRegion] ?? null : null;
}

function normalizeSupabaseUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const ref =
      projectRefFromValue(url) ||
      projectRefFromValue(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
      projectRefFromValue(process.env.SUPABASE_URL);
    const user = decodeURIComponent(parsed.username) || "postgres";
    if (ref && !user.includes(".")) {
      parsed.username = `${user}.${ref}`;
    }

    if (host.includes("pooler.supabase")) {
      if (!parsed.port || parsed.port === "5432") {
        parsed.port = "6543";
      }
      return parsed.toString();
    }

    const dbHost = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (!dbHost) {
      return parsed.toString();
    }

    const region = poolerRegionFromEnv();
    if (region) {
      parsed.hostname = `aws-0-${region}.pooler.supabase.com`;
      parsed.port = "6543";
      return parsed.toString();
    }

    if (parsed.port !== "6543") {
      parsed.port = "6543";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const direct = process.env.DIRECT_URL?.trim();
const pooledCandidates = [
  process.env.SUPABASE_POOLER_URL,
  process.env.POSTGRES_URL,
  process.env.DATABASE_URL,
  process.env.POSTGRES_PRISMA_URL,
]
  .map((value) => value?.trim())
  .filter(Boolean);

const rawUrl = pooledCandidates.find((value) => isPooled(value)) || pooledCandidates[0] || direct;
const url = rawUrl ? normalizeSupabaseUrl(rawUrl) : "";

if (!url) {
  console.log("ensure-account-policies: no DATABASE_URL, skipping");
  process.exit(0);
}

const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const migrationFiles = [
  "0012_account_table_server_policies.sql",
  "0013_pokedex_market_observations.sql",
  "0014_market_estimate_diagnostics.sql",
];
const supabase = /supabase\.(co|com)|pooler\.supabase/i.test(url);

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  ssl: supabase ? "require" : undefined,
});

try {
  for (const fileName of migrationFiles) {
    const ddl = readFileSync(join(drizzleDir, fileName), "utf8");
    await sql.unsafe(ddl);
  }
  console.log("ensure-account-policies: applied server policies and market tables");
} catch (error) {
  console.warn(
    "ensure-account-policies: skipped (",
    error instanceof Error ? error.message : error,
    ")",
  );
} finally {
  await sql.end({ timeout: 5 });
}
