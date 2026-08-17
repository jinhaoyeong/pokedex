export const SCAN_DEBUG_EVENT = "pokedex:scan-debug" as const;

export type ScanDebugInputType =
  | "digital"
  | "camera"
  | "slab"
  | "screenshot"
  | "unknown";

export type ScanDebugPoint = {
  x: number;
  y: number;
};

export type ScanDebugQuad = [
  ScanDebugPoint,
  ScanDebugPoint,
  ScanDebugPoint,
  ScanDebugPoint,
];

export interface ScanDebugClassification {
  inputType: ScanDebugInputType;
  fullBleedScore: number | null;
  cameraPhotoScore: number | null;
}

export interface ScanDebugGeometry {
  autoDetected: boolean;
  quad: ScanDebugQuad | null;
  cropConfidence: number | null;
  aspectRatio: number | null;
  coverageRatio: number | null;
  sharpnessScore: number | null;
}

export type ScanDebugImageVariantKey =
  | "original"
  | "quadOverlay"
  | "rectified"
  | "expanded"
  | "contracted"
  | "legacy";

export interface ScanDebugImageVariant {
  label: string;
  src: string;
}

export type ScanDebugImageVariants = Record<
  ScanDebugImageVariantKey,
  ScanDebugImageVariant | null
>;

export interface ScanDebugParsedCollector {
  raw: string;
  primary: string | null;
  denominator: string | null;
  prefix: string | null;
  confidence: number | null;
}

export interface ScanDebugOcrSlice {
  text: string;
  normalizedText: string;
  confidence: number | null;
  region: string;
  rotation: number;
  preprocessing: string;
  parsedCollector: ScanDebugParsedCollector | null;
}

export interface ScanDebugCandidate {
  cardId: string;
  slug: string;
  name: string;
  language: string;
  collectorNumber: string;
  setId: string;
  score: number;
  source: string;
}

export interface ScanDebugRetrieval {
  dHashCandidates: ScanDebugCandidate[];
  clipCandidates: ScanDebugCandidate[];
  exactNameCandidates: ScanDebugCandidate[];
  nameAndNumberCandidates: ScanDebugCandidate[];
  liveSearchCandidates: ScanDebugCandidate[];
}

export interface ScanDebugRankingComponents {
  dHash: number | null;
  clip: number | null;
  exactName: number | null;
  collectorNumber: number | null;
  language: number | null;
  set: number | null;
  cropQuality: number | null;
  [component: string]: number | null;
}

export interface ScanDebugRankingEntry extends ScanDebugCandidate {
  totalScore: number;
  components: ScanDebugRankingComponents;
  bonuses: Record<string, number>;
  penalties: Record<string, number>;
}

export interface ScanDebugReport {
  schemaVersion: 1;
  scanId: string;
  createdAt: string;
  durationMs: number | null;
  classification: ScanDebugClassification;
  geometry: ScanDebugGeometry;
  imageVariants: ScanDebugImageVariants;
  ocrSlices: ScanDebugOcrSlice[];
  retrieval: ScanDebugRetrieval;
  finalRanking: ScanDebugRankingEntry[];
  notes: string[];
}

type ImageVariantSeed =
  | string
  | ScanDebugImageVariant
  | null
  | undefined;

export interface ScanDebugReportSeed {
  scanId?: string;
  createdAt?: string;
  durationMs?: number | null;
  classification?: Partial<ScanDebugClassification>;
  geometry?: Partial<ScanDebugGeometry>;
  imageVariants?: Partial<Record<ScanDebugImageVariantKey, ImageVariantSeed>>;
  ocrSlices?: ScanDebugOcrSlice[];
  retrieval?: Partial<ScanDebugRetrieval>;
  finalRanking?: ScanDebugRankingEntry[];
  notes?: string[];
}

declare global {
  interface Window {
    __POKEDEX_LAST_SCAN_DEBUG__?: ScanDebugReport;
  }

  interface WindowEventMap {
    "pokedex:scan-debug": CustomEvent<ScanDebugReport>;
  }
}

const IMAGE_LABELS: Record<ScanDebugImageVariantKey, string> = {
  original: "Original",
  quadOverlay: "Quad overlay",
  rectified: "Rectified",
  expanded: "Expanded crop",
  contracted: "Contracted crop",
  legacy: "Legacy full image",
};

function createScanId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function imageVariant(
  key: ScanDebugImageVariantKey,
  seed: ImageVariantSeed,
): ScanDebugImageVariant | null {
  if (!seed) return null;
  if (typeof seed === "string") {
    return { label: IMAGE_LABELS[key], src: seed };
  }
  return {
    label: seed.label.trim() || IMAGE_LABELS[key],
    src: seed.src,
  };
}

function createImageVariants(
  seed: ScanDebugReportSeed["imageVariants"],
): ScanDebugImageVariants {
  return {
    original: imageVariant("original", seed?.original),
    quadOverlay: imageVariant("quadOverlay", seed?.quadOverlay),
    rectified: imageVariant("rectified", seed?.rectified),
    expanded: imageVariant("expanded", seed?.expanded),
    contracted: imageVariant("contracted", seed?.contracted),
    legacy: imageVariant("legacy", seed?.legacy),
  };
}

function cloneCandidate(candidate: ScanDebugCandidate): ScanDebugCandidate {
  return { ...candidate };
}

function cloneOcrSlice(slice: ScanDebugOcrSlice): ScanDebugOcrSlice {
  return {
    ...slice,
    parsedCollector: slice.parsedCollector
      ? { ...slice.parsedCollector }
      : null,
  };
}

function cloneRankingEntry(entry: ScanDebugRankingEntry): ScanDebugRankingEntry {
  return {
    ...entry,
    components: { ...entry.components },
    bonuses: { ...entry.bonuses },
    penalties: { ...entry.penalties },
  };
}

/** Diagnostics are intentionally unavailable in production bundles at runtime. */
export function isScanDebugEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Create a complete report with honest nulls for measurements not yet recorded. */
export function createScanDebugReport(
  seed: ScanDebugReportSeed = {},
): ScanDebugReport {
  return {
    schemaVersion: 1,
    scanId: seed.scanId?.trim() || createScanId(),
    createdAt: seed.createdAt ?? new Date().toISOString(),
    durationMs: seed.durationMs ?? null,
    classification: {
      inputType: seed.classification?.inputType ?? "unknown",
      fullBleedScore: seed.classification?.fullBleedScore ?? null,
      cameraPhotoScore: seed.classification?.cameraPhotoScore ?? null,
    },
    geometry: {
      autoDetected: seed.geometry?.autoDetected ?? false,
      quad: seed.geometry?.quad
        ? seed.geometry.quad.map((point) => ({ ...point })) as ScanDebugQuad
        : null,
      cropConfidence: seed.geometry?.cropConfidence ?? null,
      aspectRatio: seed.geometry?.aspectRatio ?? null,
      coverageRatio: seed.geometry?.coverageRatio ?? null,
      sharpnessScore: seed.geometry?.sharpnessScore ?? null,
    },
    imageVariants: createImageVariants(seed.imageVariants),
    ocrSlices: (seed.ocrSlices ?? []).map(cloneOcrSlice),
    retrieval: {
      dHashCandidates: (seed.retrieval?.dHashCandidates ?? []).map(cloneCandidate),
      clipCandidates: (seed.retrieval?.clipCandidates ?? []).map(cloneCandidate),
      exactNameCandidates: (seed.retrieval?.exactNameCandidates ?? []).map(cloneCandidate),
      nameAndNumberCandidates: (
        seed.retrieval?.nameAndNumberCandidates ?? []
      ).map(cloneCandidate),
      liveSearchCandidates: (seed.retrieval?.liveSearchCandidates ?? []).map(
        cloneCandidate,
      ),
    },
    finalRanking: (seed.finalRanking ?? []).map(cloneRankingEntry),
    notes: [...(seed.notes ?? [])],
  };
}

const BASE64_DATA_URL = /^data:([^;,]+)?(?:;[^,]*)?;base64,/i;

function sanitizedValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    const match = value.match(BASE64_DATA_URL);
    if (!match) return value;
    const mimeType = match[1] || "unknown MIME type";
    return `[base64 data URL omitted: ${mimeType}]`;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular reference omitted]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizedValue(item, seen));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sanitizedValue(item, seen),
    ]),
  );
}

/** Return a console/JSON-safe copy with embedded base64 image payloads removed. */
export function sanitizeScanDebugReport(report: ScanDebugReport): unknown {
  return sanitizedValue(report, new WeakSet<object>());
}

/** Publish the full report to devtools listeners while logging only a safe copy. */
export function publishScanDebugReport(
  report: ScanDebugReport,
): ScanDebugReport {
  if (!isScanDebugEnabled() || typeof window === "undefined") {
    return report;
  }

  window.__POKEDEX_LAST_SCAN_DEBUG__ = report;
  window.dispatchEvent(new CustomEvent(SCAN_DEBUG_EVENT, { detail: report }));
  console.log("[pokedex:scan-debug]", sanitizeScanDebugReport(report));
  return report;
}
