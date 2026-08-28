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

export function firstSuccessfulSearch<T extends { results: unknown[] }>(
  promises: Array<Promise<T>>,
  budgetMs: number,
  fallback: T,
): Promise<T> {
  if (!promises.length) {
    return Promise.resolve(fallback);
  }

  return new Promise((resolve) => {
    let settled = 0;
    let resolved = false;
    const finish = (value: T) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), Math.max(0, budgetMs));
    timer.unref?.();

    for (const promise of promises) {
      promise
        .then((value) => {
          settled += 1;
          if (value.results.length) {
            finish(value);
            return;
          }
          if (settled === promises.length) {
            finish(fallback);
          }
        })
        .catch(() => {
          settled += 1;
          if (settled === promises.length) {
            finish(fallback);
          }
        });
    }
  });
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

/** Standalone printed collector codes such as 071/067 or 100/095. */
export function isCollectorNumberSearchQuery(query: string) {
  const trimmed = query.trim();

  if (!trimmed.includes("/")) {
    return false;
  }

  return /^[A-Za-z]*\d+[A-Za-z]*\s*\/\s*[A-Za-z0-9][A-Za-z0-9-]{0,7}$/.test(trimmed);
}

/** Name plus a partial number, e.g. "dialga 071" or "071 Dialga". */
export function isNamePlusPartialCollectorQuery(query: string) {
  const trimmed = query.trim();

  if (!trimmed || trimmed.includes("/") || isCollectorNumberSearchQuery(trimmed)) {
    return false;
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) {
    return false;
  }

  const hasName = parts.some((part) => /^[A-Za-z][A-Za-z'-]*$/.test(part));
  const hasNumber = parts.some(
    (part) => /^#?[A-Za-z]{0,3}\d{1,4}[A-Za-z]{0,2}$/.test(part) && /\d/.test(part),
  );

  return hasName && hasNumber;
}
