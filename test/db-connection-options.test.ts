import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPostgresOptions,
  isPooledSupabaseUrl,
  isPoolSaturatedError,
  isRetryableDbError,
  isSupabaseHost,
  resolveDatabaseUrl,
} from "../src/db/connection-options";
import {
  ACCOUNT_ENSURE_TABLES_SQL,
  ACCOUNT_SERVER_POLICY_SQL,
  ACCOUNT_TABLES,
} from "../src/db/account-policy-sql";

test("pooled Supabase URLs win over a direct IPv6 db host", () => {
  const resolved = resolveDatabaseUrl({
    DATABASE_URL: "postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
    POSTGRES_URL:
      "postgresql://postgres.abcdefgh:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
  });

  assert.match(resolved, /pooler\.supabase\.com:6543/);
});

test("DATABASE_URL is used when it is already the transaction pooler", () => {
  const pooled =
    "postgresql://postgres.abcdefgh:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: pooled }), pooled);
  assert.equal(isPooledSupabaseUrl(pooled), true);
});

test("blank DATABASE_URL is not configured", () => {
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "  " }), "");
  assert.equal(resolveDatabaseUrl({ POSTGRES_URL: "postgresql://localhost/postgres" }).startsWith("postgresql://"), true);
});

test("Supabase connections require SSL and a longer connect timeout", () => {
  const url =
    "postgresql://postgres.abcdefgh:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
  const options = buildPostgresOptions(url, { VERCEL: "1" });
  assert.equal(options.ssl, "require");
  assert.equal(options.prepare, false);
  assert.equal(options.connect_timeout, 10);
  assert.equal(options.max, 1);
  assert.equal(isSupabaseHost(url), true);
});

test("local Supabase uses a small client pool", () => {
  const url =
    "postgresql://postgres.abcdefgh:secret@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const options = buildPostgresOptions(url, {});
  assert.equal(options.max, 3);
  assert.equal(options.max_lifetime, 60 * 10);
});

test("session-mode pooler URLs are rewritten to transaction port 6543", () => {
  const resolved = resolveDatabaseUrl({
    DATABASE_URL:
      "postgresql://postgres.abcdefgh:secret@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
  });

  assert.match(resolved, /aws-1-ap-northeast-1\.pooler\.supabase\.com:6543/);
  assert.doesNotMatch(resolved, /:5432/);
});

test("transaction pooler URLs win over session-mode DATABASE_URL", () => {
  const resolved = resolveDatabaseUrl({
    DATABASE_URL:
      "postgresql://postgres.abcdefgh:secret@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
    SUPABASE_POOLER_URL:
      "postgresql://postgres.abcdefgh:secret@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
  });

  assert.match(resolved, /pooler\.supabase\.com:6543/);
});

test("local Postgres skips SSL", () => {
  const options = buildPostgresOptions("postgresql://postgres:postgres@localhost:5432/pokedex");
  assert.equal(options.ssl, undefined);
  assert.equal(options.connect_timeout, 5);
});

test("account server policies cover Clerk tables and deny PostgREST roles", () => {
  for (const table of ACCOUNT_TABLES) {
    assert.match(ACCOUNT_SERVER_POLICY_SQL, new RegExp(`'${table}'`));
  }
  assert.match(ACCOUNT_SERVER_POLICY_SQL, /REVOKE ALL ON TABLE/);
  assert.match(ACCOUNT_SERVER_POLICY_SQL, /DISABLE ROW LEVEL SECURITY/);
  assert.match(ACCOUNT_SERVER_POLICY_SQL, /server_account_all/);
  assert.match(ACCOUNT_SERVER_POLICY_SQL, /anon/);
  assert.match(ACCOUNT_SERVER_POLICY_SQL, /USING \(true\)/);
  assert.match(ACCOUNT_ENSURE_TABLES_SQL, /CREATE TABLE IF NOT EXISTS public\.users/);
  assert.match(ACCOUNT_ENSURE_TABLES_SQL, /CREATE TABLE IF NOT EXISTS public\.user_settings/);
});

test("pooler URLs with a bare postgres user get the project ref appended", () => {
  const rewritten = resolveDatabaseUrl({
    DATABASE_URL:
      "postgresql://postgres:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  });

  assert.match(rewritten, /postgres\.abcdefgh/);
  assert.match(rewritten, /p%40ss|p@ss/);
  assert.match(rewritten, /pooler\.supabase\.com:6543/);
});

test("pooler URLs that already include the project ref are left alone", () => {
  const pooled =
    "postgresql://postgres.abcdefgh:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: pooled }), pooled);
});

test("row-level security failures are retried so policies can be applied", () => {
  assert.equal(
    isRetryableDbError(new Error("new row violates row-level security policy for table \"users\"")),
    true,
  );
  assert.equal(isRetryableDbError(new Error("Could not sync Clerk user to the account database.")), true);
  assert.equal(isRetryableDbError(new Error("missing required field")), false);
});

test("Supavisor session-mode exhaustion is treated as a saturated pool", () => {
  const error = new Error(
    "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15",
  );
  assert.equal(isPoolSaturatedError(error), true);
  assert.equal(isRetryableDbError(error), true);
});

test("IPv6-only db hosts rewrite onto the shared pooler using Vercel region", () => {
  const resolved = resolveDatabaseUrl({
    DATABASE_URL: "postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
    VERCEL_REGION: "sin1",
  });

  assert.match(resolved, /postgres\.abcdefgh/);
  assert.match(resolved, /aws-0-ap-southeast-1\.pooler\.supabase\.com:6543/);
});

test("direct db hosts without a region use dedicated pooler port 6543", () => {
  const resolved = resolveDatabaseUrl({
    DATABASE_URL: "postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
  });

  assert.match(resolved, /db\.abcdefgh\.supabase\.co:6543/);
  assert.match(resolved, /postgres\.abcdefgh/);
});

test("SUPABASE_REGION wins over Vercel city code for pooler rewrite", () => {
  const resolved = resolveDatabaseUrl({
    DATABASE_URL: "postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
    SUPABASE_REGION: "ap-northeast-1",
    VERCEL_REGION: "sin1",
  });

  assert.match(resolved, /aws-0-ap-northeast-1\.pooler\.supabase\.com:6543/);
});
