import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPostgresOptions,
  isPooledSupabaseUrl,
  isSupabaseHost,
  resolveDatabaseUrl,
} from "../src/db/connection-options";
import { ACCOUNT_SERVER_POLICY_SQL, ACCOUNT_TABLES } from "../src/db/account-policy-sql";

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
  assert.equal(options.max, 3);
  assert.equal(isSupabaseHost(url), true);
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
  assert.match(ACCOUNT_SERVER_POLICY_SQL, /server_account_all/);
  assert.match(ACCOUNT_SERVER_POLICY_SQL, /anon/);
  assert.match(ACCOUNT_SERVER_POLICY_SQL, /authenticated/);
});
