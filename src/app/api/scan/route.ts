import { NextResponse } from "next/server";

import { searchLiveCards } from "@/lib/pokemon-tcg-api";
import { buildScanQuery, parseOcrText } from "@/lib/scan/ocr";
import type { ScanCardGuess, ScanResponse } from "@/lib/scan/types";
import { identifyCardFromImage, isVisionScanAvailable } from "@/lib/scan/vision.server";
import { CARD_LANGUAGE_FILTERS } from "@/lib/search-constants";
import type { CardLanguageFilter } from "@/types/pokemon";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ScanRequestBody {
  image?: string;
  ocrText?: string;
  language?: string;
}

function normalizeLanguage(value: string | undefined): CardLanguageFilter {
  if (value && CARD_LANGUAGE_FILTERS.some((item) => item.code === value)) {
    return value as CardLanguageFilter;
  }
  return "all";
}

/** Best-effort guess from OCR text alone, used when vision is unavailable. */
function guessFromOcr(ocrText: string): ScanCardGuess | null {
  const parsed = parseOcrText(ocrText);
  const name = parsed.nameCandidates[0];
  if (!name) {
    return null;
  }
  return {
    name,
    number: parsed.number,
    suffix: parsed.suffix,
    confidence: 0.35,
    source: "ocr",
  };
}

export async function GET() {
  return NextResponse.json({ visionAvailable: isVisionScanAvailable() });
}

export async function POST(request: Request) {
  let body: ScanRequestBody;
  try {
    body = (await request.json()) as ScanRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const image = typeof body.image === "string" ? body.image : undefined;
  const ocrText = typeof body.ocrText === "string" ? body.ocrText : "";
  const requestedLanguage = normalizeLanguage(body.language);
  const visionAvailable = isVisionScanAvailable();

  if (!image && !ocrText.trim()) {
    return NextResponse.json(
      { error: "Provide an image or OCR text to scan." },
      { status: 400 },
    );
  }

  let guess: ScanCardGuess | null = null;
  let visionUsed = false;

  if (image && visionAvailable) {
    guess = await identifyCardFromImage(image, ocrText || undefined);
    visionUsed = guess !== null;
  }

  if (!guess) {
    guess = guessFromOcr(ocrText);
  }

  if (!guess) {
    const response: ScanResponse = {
      guess: null,
      query: "",
      results: [],
      visionUsed,
      visionAvailable,
      notice: visionAvailable
        ? "Couldn't read this card. Try a sharper, well-lit photo of the full card."
        : "Couldn't read this card automatically. Try a sharper photo, or search by name.",
    };
    return NextResponse.json(response);
  }

  const language =
    requestedLanguage === "all" ? guess.language ?? "all" : requestedLanguage;
  const query = buildScanQuery({
    name: guess.name,
    suffix: guess.suffix,
    number: guess.number,
  });

  const search = await searchLiveCards(query, undefined, 1, language, "relevance");

  const response: ScanResponse = {
    guess,
    query,
    results: search.results.slice(0, 12),
    visionUsed,
    visionAvailable,
    notice:
      search.results.length === 0
        ? `Detected "${query}" but found no catalog match. Try refining the search.`
        : undefined,
  };

  return NextResponse.json(response);
}
