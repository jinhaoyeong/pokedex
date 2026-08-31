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
export function visualSourceVoteKey(hits: VisualIndexHit[]): string {
  return (hits[0]?.name ?? "").trim().toLocaleLowerCase();
}

export function tallyVisualSourceVotes(
  entries: Array<{ role: string; hits: VisualIndexHit[] }>,
): Map<string, number> {
  const votes = new Map<string, number>();
  for (const entry of entries) {
    if (entry.role === "legacy") continue;
    const key = visualSourceVoteKey(entry.hits);
    if (!key) continue;
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  return votes;
}

/**
 * Pick the crop variant whose top identity is shared by other variants.
 * A slightly wrong expanded/glare crop can hash to Clefable at 0.81 while the
 * true rectified Charizard sits at 0.75 — raw score would pick the collision.
 */
export function compareVisualSourceVariants(
  left: { role: string; hits: VisualIndexHit[] },
  right: { role: string; hits: VisualIndexHit[] },
  votes: Map<string, number>,
): number {
  const roleRank = (role: string) =>
    role === "legacy" ? 2 : role === "expanded" ? 1 : 0;
  const vote = (hits: VisualIndexHit[]) => votes.get(visualSourceVoteKey(hits)) ?? 0;
  const margin = (hits: VisualIndexHit[]) =>
    (hits[0]?.score ?? 0) - (hits[1]?.score ?? 0);
  const score = (hits: VisualIndexHit[]) => hits[0]?.score ?? 0;
  return (
    roleRank(left.role) - roleRank(right.role) ||
    vote(right.hits) - vote(left.hits) ||
    margin(right.hits) - margin(left.hits) ||
    score(right.hits) - score(left.hits)
  );
}

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

/**
 * CLIP lookalikes (crystalline Charizard vs Clefable) can outscore a real
 * dHash of a glare/camera crop. Keep a strong hash identity on top unless the
 * neural hit is clearly better on a different Pokemon.
 */
export function fuseHashAndNeuralHits(
  hashHits: VisualIndexHit[],
  neuralHits: VisualIndexHit[],
  limit = 24,
): VisualIndexHit[] {
  const fused = mergeVisualHits([hashHits, neuralHits], limit);
  const hashTop = hashHits[0];
  const neuralTop = neuralHits[0];
  if (!hashTop || hashTop.score < 0.74) return fused;
  if (!neuralTop) return fused;
  if (hitNameKey(hashTop) === hitNameKey(neuralTop)) return fused;
  const neuralOverrules =
    neuralTop.score >= Math.max(0.84, hashTop.score + 0.1) &&
    isDecisiveVisualResult(neuralHits, 0.84);
  if (neuralOverrules) return fused;
  const rest = fused.filter((hit) => hit.id !== hashTop.id);
  return [hashTop, ...rest].slice(0, limit);
}
