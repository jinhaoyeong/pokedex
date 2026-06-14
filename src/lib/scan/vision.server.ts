import "server-only";

import type { CardLanguageFilter } from "@/types/pokemon";
import type { ScanCardGuess } from "@/lib/scan/types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_VISION_MODEL = "claude-sonnet-4-6";

/** Whether a vision model is configured for this deployment. */
export function isVisionScanAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

interface DecodedImage {
  mediaType: string;
  base64: string;
}

/** Split a `data:` URL into its media type and base64 payload. */
function decodeDataUrl(dataUrl: string): DecodedImage | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return { mediaType: match[1], base64: match[2] };
}

const ALLOWED_LANGUAGES: CardLanguageFilter[] = [
  "en",
  "fr",
  "es",
  "it",
  "pt",
  "de",
  "nl",
  "pl",
  "ru",
  "ja",
  "ko",
  "zh-tw",
  "zh-cn",
];

function normalizeLanguage(value: unknown): CardLanguageFilter | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const lower = value.toLowerCase();
  return ALLOWED_LANGUAGES.find((code) => code === lower);
}

const SYSTEM_PROMPT =
  "You identify Pokemon Trading Card Game cards from photographs. " +
  "Respond with ONLY a single minified JSON object and nothing else. " +
  'Schema: {"name":string,"number":string|null,"setName":string|null,' +
  '"language":string|null,"confidence":number}. ' +
  "`name` is the Pokemon or card name exactly as printed, including suffixes " +
  'like "ex", "V", "VMAX", "VSTAR", "GX". ' +
  "`number` is the collector number printed on the card (e.g. \"199/165\"). " +
  "`language` is the ISO-style code of the printed language (en, ja, fr, de, " +
  "es, it, pt, ko, zh-tw, zh-cn). " +
  "`confidence` is your 0-1 certainty. If the image is not a Pokemon card, " +
  'return {"name":"","number":null,"setName":null,"language":null,"confidence":0}.';

interface VisionRawResult {
  name?: unknown;
  number?: unknown;
  setName?: unknown;
  language?: unknown;
  confidence?: unknown;
}

function extractJson(text: string): VisionRawResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as VisionRawResult;
  } catch {
    return null;
  }
}

/**
 * Ask a Claude vision model to identify the card in `dataUrl`. Returns null on
 * any failure (missing key, bad image, API error, unparseable response) so the
 * caller can fall back to OCR-derived guesses.
 */
export async function identifyCardFromImage(
  dataUrl: string,
  hint?: string,
): Promise<ScanCardGuess | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  const image = decodeDataUrl(dataUrl);
  if (!image) {
    return null;
  }

  const model = process.env.SCAN_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
  const userText = hint?.trim()
    ? `Identify this Pokemon card. OCR text read from the image (may contain errors): "${hint.trim()}".`
    : "Identify this Pokemon card.";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mediaType,
                  data: image.base64,
                },
              },
              { type: "text", text: userText },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = payload.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");

    if (!text) {
      return null;
    }

    const parsed = extractJson(text);
    if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
      return null;
    }

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

    return {
      name: parsed.name.trim(),
      number:
        typeof parsed.number === "string" && parsed.number.trim()
          ? parsed.number.trim()
          : undefined,
      setName:
        typeof parsed.setName === "string" && parsed.setName.trim()
          ? parsed.setName.trim()
          : undefined,
      language: normalizeLanguage(parsed.language),
      confidence,
      source: "vision",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
