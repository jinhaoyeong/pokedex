import "server-only";

import { ACCOUNT_SERVER_POLICY_SQL } from "./account-policy-sql";
import { getDb, resetDb } from "./client";

let ensured: Promise<void> | null = null;

function isRetryableDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /connect|timeout|ECONN|ENOTFOUND|EAI_AGAIN|SSL|closed|terminat|too many clients/i.test(
    message,
  );
}

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
