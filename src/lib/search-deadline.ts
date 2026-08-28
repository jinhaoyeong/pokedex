/**
 * Search must paint identities in well under 3s. These helpers keep optional
 * cache/DB/catalog work from stretching the live request past that budget.
 */

export const FAST_SEARCH_BUDGET_MS = 2_200;
export const SEARCH_OVERLAY_BUDGET_MS = 150;
export const SEARCH_PERSIST_READ_BUDGET_MS = 150;
export const SEARCH_LOCALIZED_PREVIEW_BUDGET_MS = 700;
export const SEARCH_LEARNED_MERGE_BUDGET_MS = 150;

export function remainingSearchBudget(startedAt: number, budgetMs: number) {
  return Math.max(0, budgetMs - (Date.now() - startedAt));
}

export function withSearchBudget<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  if (ms <= 0) {
    return Promise.resolve(fallback);
  }

  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      timer.unref?.();
    }),
  ]);
}

/** One or two name tokens with no collector number — skip set-DB scans. */
export function isSimpleNameSearchQuery(query: string) {
  const trimmed = query.trim();

  if (!trimmed || /\d/.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 2;
}
