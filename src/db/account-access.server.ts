import "server-only";

import { ACCOUNT_SERVER_POLICY_SQL } from "./account-policy-sql";
import { getDb, resetDb } from "./client";
import { isRetryableDbError } from "./connection-options";

let ensured: Promise<void> | null = null;

async function applyAccountPolicies() {
  await getDb().$client.unsafe(ACCOUNT_SERVER_POLICY_SQL);
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

    resetDb();
    ensured = null;
    await ensureServerAccountAccess();
    return run();
  }
}
