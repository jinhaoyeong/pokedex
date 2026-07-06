/**
 * Sanitizes database errors for server-action responses. Drizzle wraps every
 * query failure in "Failed query: <full SQL> params: <values>" — leaking that
 * to the client exposes schema/PII and hides the actual Postgres error, which
 * lives on `error.cause`. Intentional user-facing messages ("Sign in to ...")
 * pass through untouched.
 */
export function toUserActionMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    console.error("Action failed with non-Error value:", error);
    return fallback;
  }

  // Full detail (including the wrapped query and cause) goes to the server log.
  console.error("Action failed:", error);

  if (/^Failed query/i.test(error.message)) {
    const cause = (error as { cause?: unknown }).cause;
    const causeMessage =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";

    return causeMessage ? `Database error: ${causeMessage}` : fallback;
  }

  return error.message;
}
