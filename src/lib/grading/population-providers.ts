import "server-only";

import { fetchMarketText, MarketHttpError } from "@/lib/market/http-client";
import {
  normalizePopulationForIdentity,
  type MarketCardIdentity,
} from "@/lib/market/card-identity";
import {
  fetchPriceChartingPopulation,
  isPriceChartingApiConfigured,
} from "@/lib/market/pricecharting-provider";
import type {
  GradingService,
  MarketSourceStatus,
  PsaPopulationSnapshot,
} from "@/types/pokemon";

export type PopulationService = Extract<GradingService, "PSA" | "CGC" | "BGS">;

export type PopulationProviderResult = {
  provider: string;
  service: PopulationService;
  population: PsaPopulationSnapshot | null;
  sourceStatus: MarketSourceStatus;
};

export interface PopulationProvider {
  readonly id: string;
  readonly label: string;
  readonly service: PopulationService;
  isConfigured(): boolean;
  fetchPopulation(
    identity: MarketCardIdentity,
    signal?: AbortSignal,
  ): Promise<PopulationProviderResult>;
}

type EndpointPayload = unknown;

const ENDPOINT_ENV_KEYS: Record<PopulationService, string[]> = {
  PSA: ["PSA_POPULATION_ENDPOINT_TEMPLATE", "PSA_POPULATION_API_URL"],
  CGC: ["CGC_POPULATION_ENDPOINT_TEMPLATE", "CGC_POPULATION_API_URL"],
  BGS: ["BGS_POPULATION_ENDPOINT_TEMPLATE", "BGS_POPULATION_API_URL"],
};

function nowIso() {
  return new Date().toISOString();
}

function envTemplate(service: PopulationService) {
  return ENDPOINT_ENV_KEYS[service]
    .map((key) => process.env[key]?.trim())
    .find(Boolean);
}

function sourceStatus(input: {
  source: string;
  state: MarketSourceStatus["state"];
  confidenceScore: number;
  note: string;
  sourceUrl?: string;
  sampleCount?: number;
  warning?: string;
}): MarketSourceStatus {
  return {
    source: input.source,
    state: input.state,
    confidence:
      input.confidenceScore >= 0.68 ? "high" : input.confidenceScore >= 0.4 ? "medium" : "low",
    confidenceScore: input.confidenceScore,
    fetchedAt: nowIso(),
    note: input.note,
    sourceUrl: input.sourceUrl,
    sampleCount: input.sampleCount,
    warning: input.warning,
  };
}

function pendingSnapshot(
  service: PopulationService,
  source: string,
  note: string,
  sourceUrl?: string,
): PsaPopulationSnapshot {
  return {
    status: "pending",
    totalCertified: null,
    grades: [],
    source,
    fetchedAt: nowIso(),
    sourceUrl,
    note,
    service,
    confidence: "low",
    confidenceScore: 0.2,
    evidenceType: "population",
  };
}

function renderEndpoint(template: string, identity: MarketCardIdentity, service: PopulationService) {
  const values: Record<string, string> = {
    service,
    priceChartingToken:
      process.env.PRICECHARTING_API_KEY?.trim() ||
      process.env.PRICECHARTING_API_TOKEN?.trim() ||
      "",
    priceChartingQuery: identity.priceChartingQueries[0] ?? "",
    language: identity.language,
    languageLabel: identity.languageLabel,
    setCode: identity.setCode ?? "",
    setName: identity.nativeSetName,
    englishSetName: identity.englishSetName,
    cardName: identity.nativeName,
    englishName: identity.englishName,
    collectorNumber: identity.collectorNumber,
    numberBase: identity.numberBase,
    numberWithTotal: identity.numberWithTotal,
    setTotal: identity.setTotal ? String(identity.setTotal) : "",
  };

  if (template.includes("{")) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) =>
      encodeURIComponent(values[key] ?? ""),
    );
  }

  const url = new URL(template);
  for (const [key, value] of Object.entries(values)) {
    if (value && !url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function gradeLabel(service: PopulationService, value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${service} ${value}`;
  }

  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return null;
  }

  if (/^(PSA|CGC|BGS)\b/i.test(raw)) {
    return raw.toUpperCase().replace(/\s+/g, " ");
  }

  const gradeMatch = raw.match(/\b(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)\b/);
  return gradeMatch ? `${service} ${gradeMatch[1]}` : `${service} ${raw}`;
}

function parseJsonPopulation(
  payload: EndpointPayload,
  service: PopulationService,
  source: string,
  sourceUrl: string,
): PsaPopulationSnapshot | null {
  const root =
    asRecord(payload)?.population ??
    asRecord(payload)?.data ??
    asRecord(payload)?.result ??
    payload;
  const record = asRecord(root);
  const gradesInput =
    [
      asArray(record?.grades),
      asArray(record?.gradeCounts),
      asArray(record?.population),
    ].find((items) => items.length > 0) ?? [];
  const grades = gradesInput.flatMap((entry) => {
    const row = asRecord(entry);
    if (!row) {
      return [];
    }

    const label = gradeLabel(
      service,
      row.grade ?? row.label ?? row.name ?? row.gradeLabel ?? row.score,
    );
    const count =
      numberValue(row.count) ??
      numberValue(row.population) ??
      numberValue(row.populationCount) ??
      numberValue(row.total);

    if (!label || count == null || count < 0) {
      return [];
    }

    return [
      {
        grade: label,
        count,
        service,
        confidence: "medium" as const,
        confidenceScore: 0.66,
        evidenceType: "population" as const,
        sourceUrl,
      },
    ];
  });
  const explicitTotal =
    numberValue(record?.totalCertified) ??
    numberValue(record?.total) ??
    numberValue(record?.populationTotal) ??
    numberValue(record?.count);
  const totalCertified =
    explicitTotal ?? (grades.length ? grades.reduce((sum, grade) => sum + grade.count, 0) : null);

  if (totalCertified == null && !grades.length) {
    return null;
  }

  return {
    status: "verified",
    totalCertified,
    grades,
    source,
    fetchedAt: nowIso(),
    sourceUrl,
    note:
      totalCertified === 0
        ? `${service} returned an explicit zero population for this exact identity.`
        : `${service} population normalized from a configured provider endpoint.`,
    service,
    confidence: grades.length || totalCertified === 0 ? "medium" : "low",
    confidenceScore: grades.length ? 0.68 : totalCertified === 0 ? 0.55 : 0.35,
    evidenceType: "population",
  };
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|td|th|li|div|p)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlPopulation(
  html: string,
  service: PopulationService,
  source: string,
  sourceUrl: string,
): PsaPopulationSnapshot | null {
  const text = stripHtml(html);
  const grades: PsaPopulationSnapshot["grades"] = [];
  const seen = new Set<string>();
  const rowRegex =
    /\b(?:PSA|CGC|BGS)?\s*(?:grade|gem mint|pristine|mint)?\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)\b[^0-9]{0,80}([0-9][0-9,]*)\b/gi;

  for (const match of text.matchAll(rowRegex)) {
    const label = `${service} ${match[1]}`;
    if (seen.has(label)) {
      continue;
    }

    const count = numberValue(match[2]);
    if (count == null || count < 0) {
      continue;
    }

    seen.add(label);
    grades.push({
      grade: label,
      count,
      service,
      confidence: "low",
      confidenceScore: 0.42,
      evidenceType: "population",
      sourceUrl,
      warning: "Parsed from a configured HTML endpoint; verify against the provider UI if counts look unusual.",
    });
  }

  const totalMatch = text.match(/\b(?:total certified|total population|population total|total)\b[^0-9]{0,60}([0-9][0-9,]*)/i);
  const totalCertified =
    numberValue(totalMatch?.[1]) ??
    (grades.length ? grades.reduce((sum, grade) => sum + grade.count, 0) : null);

  if (totalCertified == null && !grades.length) {
    return null;
  }

  return {
    status: "verified",
    totalCertified,
    grades,
    source,
    fetchedAt: nowIso(),
    sourceUrl,
    note: `${service} population parsed from a configured HTML provider endpoint.`,
    service,
    confidence: grades.length ? "medium" : "low",
    confidenceScore: grades.length ? 0.55 : 0.32,
    evidenceType: "population",
  };
}

function parsePopulationPayload(
  text: string,
  service: PopulationService,
  source: string,
  sourceUrl: string,
) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseJsonPopulation(JSON.parse(trimmed), service, source, sourceUrl);
    } catch {
      return null;
    }
  }

  return parseHtmlPopulation(text, service, source, sourceUrl);
}

function disabledResult(provider: string, label: string, service: PopulationService) {
  return {
    provider,
    service,
    population: null,
    sourceStatus: sourceStatus({
      source: label,
      state: "disabled",
      confidenceScore: 0.1,
      note: `${service} population provider is disabled. Configure ${ENDPOINT_ENV_KEYS[service].join(
        " or ",
      )} to enable it.`,
    }),
  };
}

function createEndpointPopulationProvider(service: PopulationService): PopulationProvider {
  const id = `${service.toLowerCase()}-population`;
  const label = `${service} population provider`;

  return {
    id,
    label,
    service,
    isConfigured() {
      return Boolean(envTemplate(service));
    },
    async fetchPopulation(identity: MarketCardIdentity, signal?: AbortSignal) {
      const template = envTemplate(service);
      if (!template) {
        return disabledResult(id, label, service);
      }

      let url = "";

      try {
        url = renderEndpoint(template, identity, service);
        const text = await fetchMarketText(url, {
          accept: "text",
          language: identity.language,
          signal,
          timeoutMs: 12_000,
        });
        const parsed = parsePopulationPayload(text, service, label, url);
        const normalized = parsed
          ? normalizePopulationForIdentity(identity, parsed, {
              allowEnglishParallel: true,
              service,
            })
          : null;

        if (!normalized) {
          return {
            provider: id,
            service,
            population: pendingSnapshot(
              service,
              label,
              `${service} endpoint responded, but no population table matched this card identity.`,
              url,
            ),
            sourceStatus: sourceStatus({
              source: label,
              state: "no_match",
              confidenceScore: 0.25,
              note: `${service} endpoint responded, but no exact population match was found.`,
              sourceUrl: url,
            }),
          };
        }

        return {
          provider: id,
          service,
          population: normalized,
          sourceStatus: sourceStatus({
            source: label,
            state: "ready",
            confidenceScore: normalized.confidenceScore ?? 0.6,
            note: `${service} population was normalized for ${identity.languageLabel} ${identity.nativeSetName} ${identity.nativeName}.`,
            sourceUrl: normalized.sourceUrl ?? url,
            sampleCount: normalized.grades.length,
            warning: normalized.warning,
          }),
        };
      } catch (error) {
        const blocked = error instanceof MarketHttpError && error.code === "blocked";
        return {
          provider: id,
          service,
          population: pendingSnapshot(
            service,
            label,
            blocked
              ? `${service} endpoint blocked the request; leaving population pending.`
              : `${service} endpoint failed before population could be normalized.`,
            url || undefined,
          ),
          sourceStatus: sourceStatus({
            source: label,
            state: "failed",
            confidenceScore: 0.18,
            note: blocked
              ? `${service} endpoint blocked the request. Use an approved API/feed or cached import for this provider.`
              : `${service} endpoint failed.`,
            sourceUrl: url || undefined,
            warning: error instanceof Error ? error.message : "Unknown provider error",
          }),
        };
      }
    },
  };
}

export const psaPopulationProvider = createEndpointPopulationProvider("PSA");
export const cgcPopulationProvider = createEndpointPopulationProvider("CGC");
export const bgsPopulationProvider = createEndpointPopulationProvider("BGS");

function createPriceChartingPopulationProvider(service: PopulationService): PopulationProvider {
  const id = `pricecharting-${service.toLowerCase()}-population`;

  return {
    id,
    label: `PriceCharting API ${service} population`,
    service,
    isConfigured: isPriceChartingApiConfigured,
    async fetchPopulation(identity: MarketCardIdentity, signal?: AbortSignal) {
      const { population, sourceStatus: status } = await fetchPriceChartingPopulation(
        {
          language: identity.language,
          name: identity.nativeName,
          englishName: identity.englishName,
          setName: identity.nativeSetName,
          setEnglishName: identity.englishSetName,
          setCode: identity.setCode,
          collectorNumber: identity.collectorNumber,
          setTotal: identity.setTotal,
        },
        service,
        signal,
      );

      return {
        provider: id,
        service,
        population,
        sourceStatus: {
          ...status,
          source: `PriceCharting API ${service} population`,
        },
      };
    },
  };
}

export const priceChartingPsaPopulationProvider =
  createPriceChartingPopulationProvider("PSA");
export const priceChartingCgcPopulationProvider =
  createPriceChartingPopulationProvider("CGC");
export const priceChartingBgsPopulationProvider =
  createPriceChartingPopulationProvider("BGS");

export const POPULATION_PROVIDERS: PopulationProvider[] = [
  priceChartingPsaPopulationProvider,
  priceChartingCgcPopulationProvider,
  priceChartingBgsPopulationProvider,
  psaPopulationProvider,
  cgcPopulationProvider,
  bgsPopulationProvider,
];
