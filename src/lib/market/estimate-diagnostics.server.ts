import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { marketEstimateDiagnostics } from "@/db/schema";

export type EstimateDiagnosticInput = {
  cardSlug: string;
  grade: string;
  reasonCode: string;
  outcome: "blocked" | "widened";
  evidence: Record<string, unknown>;
};

const WRITE_TIMEOUT_MS = 4_000;

function timeoutError(ms: number) {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("market_estimate_diagnostics write timed out")), ms);
  });
}

export function estimateDiagnosticFingerprint(input: EstimateDiagnosticInput) {
  const payload = [
    input.cardSlug.trim().toLowerCase(),
    input.grade.trim().toLowerCase(),
    input.reasonCode,
    input.outcome,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

function logDiagnostic(input: EstimateDiagnosticInput, fingerprint: string) {
  console.info(
    JSON.stringify({
      type: "market_estimate_diagnostic",
      fingerprint,
      cardSlug: input.cardSlug,
      grade: input.grade,
      reasonCode: input.reasonCode,
      outcome: input.outcome,
      evidence: input.evidence,
    }),
  );
}

export async function recordEstimateDiagnostic(input: EstimateDiagnosticInput) {
  const fingerprint = estimateDiagnosticFingerprint(input);
  logDiagnostic(input, fingerprint);

  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    const db = getDb();
    const now = new Date();
    await Promise.race([
      db
        .insert(marketEstimateDiagnostics)
        .values({
          fingerprint,
          cardSlug: input.cardSlug,
          grade: input.grade,
          reasonCode: input.reasonCode,
          outcome: input.outcome,
          evidence: input.evidence,
          occurrenceCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          reviewStatus: "pending",
        })
        .onConflictDoUpdate({
          target: marketEstimateDiagnostics.fingerprint,
          set: {
            occurrenceCount: sql`${marketEstimateDiagnostics.occurrenceCount} + 1`,
            lastSeenAt: now,
            evidence: input.evidence,
          },
        }),
      timeoutError(WRITE_TIMEOUT_MS),
    ]);
  } catch (error) {
    console.warn("market_estimate_diagnostic persist failed", {
      fingerprint,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function recordEstimateDiagnostics(inputs: EstimateDiagnosticInput[]) {
  await Promise.all(inputs.map((input) => recordEstimateDiagnostic(input)));
}
