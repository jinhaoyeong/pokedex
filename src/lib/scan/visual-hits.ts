import type { VisualIndexHit } from "@/lib/scan/types";
import type { SearchResult } from "@/types/pokemon";

/**
 * Keep the highest-scoring hit per card id. Used to fuse CLIP and dHash
 * candidates instead of letting one method wipe the other.
 */
export function mergeVisualHits(
  groups: VisualIndexHit[][],
  limit = 24,
): VisualIndexHit[] {
  const best = new Map<string, VisualIndexHit>();
  for (const group of groups) {
    for (const hit of group) {
      const previous = best.get(hit.id);
      if (!previous || hit.score > previous.score) {
        best.set(hit.id, hit);
      }
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Keep the highest-scoring hydrated card per slug. */
export function mergeSearchResults(
  groups: SearchResult[][],
  limit = 24,
): SearchResult[] {
  const best = new Map<string, SearchResult>();
  for (const group of groups) {
    for (const result of group) {
      const key = result.card.slug;
      const previous = best.get(key);
      if (!previous || result.score > previous.score) {
        best.set(key, result);
      }
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function hitNameKey(hit: VisualIndexHit): string {
  return hit.name.trim().toLocaleLowerCase();
}

/**
 * True when the top visual hit is a clear artwork identity — not a dHash
 * collision with a different Pokemon. Same-name reprints may share a score
 * band; those are still decisive (the user can pick the print).
 */
export function isDecisiveVisualResult(
  hits: VisualIndexHit[],
  minimumScore: number,
): boolean {
  const top = hits[0];
  if (!top || top.score < minimumScore) return false;

  const topName = hitNameKey(top);
  const rival = hits.find((hit) => hitNameKey(hit) !== topName);
  const margin = top.score - (rival?.score ?? 0);

  // Near-exact catalog / HD-scan matches: a small gap is enough.
  if (top.score >= 0.88 && margin >= 0.035) return true;
  // Weaker hashes need a wider gap so Tentacool-style collisions stay ties.
  return margin >= 0.07;
}
