import "server-only";

import {
  JAPANESE_CARD_NAME_OVERRIDES,
  parseJapaneseCardNameSuffix,
} from "@/lib/japanese-name-overrides";
import { resolvePokemonNameToEnglish } from "@/lib/pokemon-name-db.server";

const TCGDEX_API_BASE_URL = "https://api.tcgdex.net/v2";

export type JapaneseCardIdentityInput = {
  jpName: string;
  setCode?: string;
  collectorNumber?: string;
  cardId?: string;
  // When true, resolve the English name from local data only and skip the
  // per-card TCGdex network lookup. Used for official-only Japanese supplement
  // sets that have no TCGdex records, so the lookup is guaranteed to miss and
  // only adds latency (and timeout risk) on serverless.
  skipTcgdex?: boolean;
};

const englishNameByKey = new Map<string, string | undefined>();

function identityKey(input: JapaneseCardIdentityInput) {
  if (input.cardId?.trim()) {
    return `id:${input.cardId.trim()}`;
  }

  if (input.setCode?.trim() && input.collectorNumber?.trim()) {
    return `set:${input.setCode.trim().toUpperCase()}:${input.collectorNumber.trim()}`;
  }

  return `name:${input.jpName.trim()}`;
}

async function fetchTcgdexJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`TCGdex request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function buildTcgdexSetIdCandidates(setCode: string) {
  const trimmed = setCode.trim();
  const lower = trimmed.toLowerCase();
  const upper = trimmed.toUpperCase();

  return [...new Set([
    trimmed,
    lower,
    upper,
    lower.replace(/^([a-z]+)(\d+)([a-z]*)$/i, (_, prefix, digits, suffix) =>
      `${prefix.toUpperCase()}${digits}${suffix.toLowerCase()}`,
    ),
  ])].filter(Boolean);
}

async function resolveEnglishNameViaTcgdex(setCode: string, collectorNumber: string) {
  const normalizedNumber = collectorNumber.replace(/^0+(?=\d)/, "");
  const setCandidates = buildTcgdexSetIdCandidates(setCode);

  for (const setId of setCandidates) {
    try {
      const localizedSet = await fetchTcgdexJson<{
        cards?: Array<{ id: string; localId: string }>;
      }>(`${TCGDEX_API_BASE_URL}/ja/sets/${encodeURIComponent(setId)}`);
      const brief = localizedSet.cards?.find(
        (card) => card.localId.replace(/^0+(?=\d)/, "") === normalizedNumber,
      );

      if (!brief) {
        continue;
      }

      const englishCard = await fetchTcgdexJson<{ name: string }>(
        `${TCGDEX_API_BASE_URL}/en/cards/${encodeURIComponent(brief.id)}`,
      ).catch(() => null);

      if (englishCard?.name?.trim()) {
        return englishCard.name.trim();
      }
    } catch {
      // Try the next set id candidate.
    }
  }

  return undefined;
}

function rememberResolvedName(keys: string[], value: string | undefined) {
  for (const key of keys) {
    englishNameByKey.set(key, value);
  }
}

export function getCachedJapaneseEnglishName(input: JapaneseCardIdentityInput) {
  return englishNameByKey.get(identityKey(input));
}

export async function resolveJapaneseCardIdentity(
  input: JapaneseCardIdentityInput,
): Promise<string | undefined> {
  const trimmed = input.jpName.trim();
  const key = identityKey(input);

  if (!trimmed && !input.setCode) {
    return undefined;
  }

  if (englishNameByKey.has(key)) {
    return englishNameByKey.get(key);
  }

  const cacheKeys = [key, trimmed ? `name:${trimmed}` : ""].filter(Boolean);

  if (!input.skipTcgdex && input.setCode && input.collectorNumber) {
    const fromTcgdex = await resolveEnglishNameViaTcgdex(
      input.setCode,
      input.collectorNumber,
    );

    if (fromTcgdex) {
      rememberResolvedName(cacheKeys, fromTcgdex);
      return fromTcgdex;
    }
  }

  if (trimmed) {
    const fromDatabase = resolvePokemonNameToEnglish(trimmed, "ja");

    if (fromDatabase) {
      rememberResolvedName(cacheKeys, fromDatabase);
      return fromDatabase;
    }

    const override = JAPANESE_CARD_NAME_OVERRIDES[trimmed];

    if (override) {
      rememberResolvedName(cacheKeys, override);
      return override;
    }

    const { base, englishSuffix } = parseJapaneseCardNameSuffix(trimmed);
    const baseOverride = JAPANESE_CARD_NAME_OVERRIDES[base];

    if (baseOverride) {
      const resolved = `${baseOverride}${englishSuffix}`;
      rememberResolvedName(cacheKeys, resolved);
      return resolved;
    }

    // Multi-Pokémon "&" names (e.g. tag-team cards): resolve each part from the
    // local name DB and recombine. The bundled name DB carries every species in
    // Japanese (both ja and ja-Hrkt), so this fully replaces the old PokeAPI
    // species-map fallback — a ~2000-request network fan-out that ran on the
    // first Japanese browse per cold serverless instance, added ~30s of latency,
    // and could push the route past its time budget.
    if (base.includes("&")) {
      const parts = base
        .split("&")
        .map((part) => part.trim())
        .filter(Boolean);
      const englishParts = parts.map(
        (part) => JAPANESE_CARD_NAME_OVERRIDES[part] ?? resolvePokemonNameToEnglish(part, "ja"),
      );

      if (englishParts.length === parts.length && englishParts.every(Boolean)) {
        const resolved = `${englishParts.join(" & ")}${englishSuffix}`;
        rememberResolvedName(cacheKeys, resolved);
        return resolved;
      }
    }

    // Single species via the Japanese-aware base parser (catches suffixes the
    // English DB parser doesn't strip). DB-only, so it's safe even on the
    // local-data-only (skipTcgdex) path.
    if (base !== trimmed) {
      const englishBase = resolvePokemonNameToEnglish(base, "ja");

      if (englishBase) {
        const resolved = `${englishBase}${englishSuffix}`;
        rememberResolvedName(cacheKeys, resolved);
        return resolved;
      }
    }
  }

  rememberResolvedName(cacheKeys, undefined);
  return undefined;
}
