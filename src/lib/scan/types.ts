import type { CardLanguageFilter, SearchResult } from "@/types/pokemon";

/** Structured guess extracted from a scanned card image. */
export interface ScanCardGuess {
  /** Best-guess card / Pokemon name. */
  name: string;
  /** Collector number such as "058" or "058/198" when detected. */
  number?: string;
  /** Name suffix such as "ex" / "vstar" when detected. */
  suffix?: string;
  /** Detected card language, when known. */
  language?: CardLanguageFilter;
  /** 0-1 heuristic confidence that the guess is usable for search. */
  confidence: number;
  /** How the guess was produced. */
  source: "ocr" | "memory";
}

/** How a candidate was visually scored against the scanned photo. */
export type VisualMethod = "neural" | "phash" | "none";

/** A catalog match re-ranked by visual similarity to the scanned photo. */
export interface ScanMatch {
  result: SearchResult;
  /** 0-1 visual similarity to the photo (1 = identical art). */
  visualScore: number;
  method: VisualMethod;
}
