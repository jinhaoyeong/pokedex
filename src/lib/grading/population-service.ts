import "server-only";

import {
  buildMarketCardIdentity,
  type MarketCardIdentity,
  type MarketCardIdentityInput,
} from "@/lib/market/card-identity";
import {
  POPULATION_PROVIDERS,
  type PopulationProviderResult,
  type PopulationService,
} from "@/lib/grading/population-providers";
import type { EvidenceSummary, MarketSourceStatus, PsaPopulationSnapshot } from "@/types/pokemon";

export type GradingPopulationResult = {
  identity: MarketCardIdentity;
  primaryPopulation: PsaPopulationSnapshot | null;
  populations: Partial<Record<PopulationService, PsaPopulationSnapshot>>;
  providerResults: PopulationProviderResult[];
  sourceStatus: MarketSourceStatus[];
  evidenceSummary: EvidenceSummary;
};

function populationScore(snapshot: PsaPopulationSnapshot | null) {
  if (!snapshot) {
    return 0;
  }

  const gradeScore = snapshot.grades.filter((grade) => grade.count > 0).length * 12;
  const totalScore =
    typeof snapshot.totalCertified === "number"
      ? Math.min(30, Math.log10(Math.max(snapshot.totalCertified, 1)) * 10)
      : 0;
  return gradeScore + totalScore + (snapshot.confidenceScore ?? 0.2) * 10;
}

function selectPrimaryPopulation(
  populations: Partial<Record<PopulationService, PsaPopulationSnapshot>>,
) {
  return (Object.values(populations) as PsaPopulationSnapshot[])
    .filter(Boolean)
    .sort((left, right) => populationScore(right) - populationScore(left))[0] ?? null;
}

function serviceList(services?: string): PopulationService[] {
  const allowed: PopulationService[] = ["PSA", "CGC", "BGS"];
  if (!services?.trim()) {
    return allowed;
  }

  const requested = services
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is PopulationService => allowed.includes(item as PopulationService));

  return requested.length ? requested : allowed;
}

export async function fetchGradingPopulations(
  input: MarketCardIdentityInput,
  options: { services?: string; signal?: AbortSignal } = {},
): Promise<GradingPopulationResult> {
  const identity = buildMarketCardIdentity(input);
  const wantedServices = new Set(serviceList(options.services));
  const providers = POPULATION_PROVIDERS.filter((provider) => wantedServices.has(provider.service));
  const settled = await Promise.allSettled(
    providers.map((provider) => provider.fetchPopulation(identity, options.signal)),
  );
  const providerResults = settled.flatMap((entry, index) => {
    if (entry.status === "fulfilled") {
      return [entry.value];
    }

    const provider = providers[index];
    return [
      {
        provider: provider.id,
        service: provider.service,
        population: null,
        sourceStatus: {
          source: provider.label,
          state: "failed" as const,
          confidence: "low" as const,
          confidenceScore: 0.1,
          fetchedAt: new Date().toISOString(),
          note: `${provider.service} population provider threw before returning a structured result.`,
          warning: entry.reason instanceof Error ? entry.reason.message : "Unknown provider error",
        },
      },
    ];
  });
  const populations = providerResults.reduce<Partial<Record<PopulationService, PsaPopulationSnapshot>>>(
    (acc, result) => {
      if (
        result.population &&
        populationScore(result.population) > populationScore(acc[result.service] ?? null)
      ) {
        acc[result.service] = result.population;
      }
      return acc;
    },
    {},
  );
  const primaryPopulation = selectPrimaryPopulation(populations);
  const sourceStatus = providerResults.map((result) => result.sourceStatus);
  const accepted = Object.values(populations).filter(
    (snapshot) => snapshot && (snapshot.grades.length > 0 || snapshot.totalCertified != null),
  ).length;

  return {
    identity,
    primaryPopulation,
    populations,
    providerResults,
    sourceStatus,
    evidenceSummary: {
      accepted,
      rejected: providerResults.length - accepted,
      thin: Object.values(populations).filter(
        (snapshot) => snapshot && snapshot.grades.length === 0 && snapshot.totalCertified === 0,
      ).length,
      fallback: sourceStatus.filter((status) => status.state !== "ready").length,
      sourceStatus,
    },
  };
}
