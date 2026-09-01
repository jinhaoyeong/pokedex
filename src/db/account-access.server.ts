import "server-only";

import {
  ACCOUNT_ENSURE_TABLES_SQL,
  ACCOUNT_SERVER_POLICY_SQL,
} from "./account-policy-sql";
import { getDb, resetDb } from "./client";
import { isPoolSaturatedError, isRetryableDbError } from "./connection-options";

let ensured: Promise<void> | null = null;

async function applyAccountPolicies() {
  const sql = getDb().$client;
  await sql.unsafe(ACCOUNT_ENSURE_TABLES_SQL);
  await sql.unsafe(ACCOUNT_SERVER_POLICY_SQL);
}

/**
 * Idempotent: grant the serverless Postgres role access to Clerk-linked
 * account tables. Safe to call on every settings/vault request.
 */
export async function ensureServerAccountAccess() {
  if (!ensured) {
    ensured = applyAccountPolicies().catch((error) => {
      ensured = null;
      console.error("Failed to ensure account table RLS policies", error);
      throw error;
    });
  }

  await ensured;
}

export async function withAccountDbRetry<T>(run: () => Promise<T>): Promise<T> {
  await ensureServerAccountAccess();

  try {
    return await run();
  } catch (error) {
    if (!isRetryableDbError(error)) {
      throw error;
    }

    // Opening a second pool while Supavisor is already at pool_size makes
    // EMAXCONNSESSION worse. Wait and reuse the existing client instead.
    if (isPoolSaturatedError(error)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return run();
    }

    resetDb();
    ensured = null;
    await ensureServerAccountAccess();
    return run();
  }
}
