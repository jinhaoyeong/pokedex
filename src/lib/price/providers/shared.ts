/** Small shared helpers for price providers. */

/** Approximate EUR→USD (Cardmarket prices are EUR). Mirrors cards.ts fallback (1 USD ≈ 0.93 EUR). */
export const EUR_TO_USD = 1.08;

export function nowIso() {
  return new Date().toISOString();
}

/** Lowercased, hyphen-collapsed slug for building provider-native ids/queries. */
export function slugifyId(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

/** Build a provider-native card id like `sv2a-201` from set code + number. */
export function providerCardId(setCode: string | undefined, collectorNumber: string | undefined) {
  const code = (setCode ?? "").trim().toLowerCase();
  const number = (collectorNumber ?? "").trim().toLowerCase();
  if (!code || !number) {
    return "";
  }
  return `${code}-${number}`;
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T | null> {
  const { timeoutMs = 8_000, headers, signal } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const composite = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const response = await fetch(url, { headers, signal: composite });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Median of positive numbers, 0 when empty. */
export function median(values: number[]): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
