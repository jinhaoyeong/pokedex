import type { PsaPopulationSnapshot } from "@/types/pokemon";

/** Client-safe helper — do not import psa-population.ts from client components. */
export function usesEnglishParallelPsaPopulation(snapshot: PsaPopulationSnapshot) {
  return snapshot.attribution === "english_parallel_psa";
}
