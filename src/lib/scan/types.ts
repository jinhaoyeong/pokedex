import type { CardLanguageFilter, SearchResult } from "@/types/pokemon";

/** Structured guess extracted from a scanned card image (OCR or vision). */
export interface ScanCardGuess {
  /** Best-guess card / Pokemon name. */
  name: string;
  /** Collector number such as "058" or "058/198" when detected. */
  number?: string;
  /** Name suffix such as "ex" / "vstar" when detected. */
  suffix?: string;
  /** Printed set name when a vision model can read it. */
  setName?: string;
  /** Detected card language, when known. */
  language?: CardLanguageFilter;
  /** 0-1 heuristic confidence that the guess is usable for search. */
  confidence: number;
  /** How the guess was produced. */
  source: "ocr" | "vision";
}

/** Response returned by POST /api/scan. */
export interface ScanResponse {
  guess: ScanCardGuess | null;
  /** Search query string that was run against the live catalog. */
  query: string;
  /** Ranked card matches for the detected card. */
  results: SearchResult[];
  /** Whether a vision model was used to refine the guess. */
  visionUsed: boolean;
  /** Whether a vision model is configured in this deployment. */
  visionAvailable: boolean;
  notice?: string;
}
