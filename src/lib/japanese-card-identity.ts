import "server-only";

import {
  JAPANESE_CARD_NAME_OVERRIDES,
  parseJapaneseCardNameAffixes,
} from "@/lib/japanese-name-overrides";
import {
  resolveEnglishNameByDexId,
  resolvePokemonNameToEnglish,
} from "@/lib/pokemon-name-db.server";
import { inferEnglishNameFromTcgdexLocalizedName } from "@/lib/tcgdex-japanese-name";
import { isPokemonTcgPocketPrint } from "@/lib/pokemon-tcg/tcg-pocket";

export type JapaneseCardIdentityInput = {
  jpName: string;
  setCode?: string;
  collectorNumber?: string;
  cardId?: string;
  dexIds?: number[];
  // Kept for callers. Identity is local-data-only now — same-id TCGdex English
  // cards are the English parallel print, not the Japanese card.
  skipTcgdex?: boolean;
};

const englishNameByKey = new Map<string, string | undefined>();

function identityKey(input: JapaneseCardIdentityInput) {
  const name = input.jpName.trim();

  if (input.cardId?.trim()) {
    return `id:${input.cardId.trim()}:${name}`;
  }

  if (input.setCode?.trim() && input.collectorNumber?.trim()) {
    return `set:${input.setCode.trim().toUpperCase()}:${input.collectorNumber.trim()}:${name}`;
  }

  return `name:${name}`;
}

function rememberResolvedName(keys: string[], value: string | undefined) {
  for (const key of keys) {
    englishNameByKey.set(key, value);
  }
}

const tcgdexDexIdsByCardId = new Map<string, number[] | undefined>();

export async function fetchTcgdexJapaneseDexIds(cardId?: string | null) {
  const id = cardId?.trim();
  if (!id || isPokemonTcgPocketPrint({ id })) {
    return undefined;
  }

  if (tcgdexDexIdsByCardId.has(id)) {
    return tcgdexDexIdsByCardId.get(id);
  }

  try {
    const response = await fetch(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(id)}`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(6_000),
    });

    if (!response.ok) {
      tcgdexDexIdsByCardId.set(id, undefined);
      return undefined;
    }

    const payload = (await response.json()) as { dexId?: number[] };
    const dexIds = (payload.dexId ?? []).filter((value) => Number.isFinite(value) && value > 0);
    tcgdexDexIdsByCardId.set(id, dexIds.length ? dexIds : undefined);
    return tcgdexDexIdsByCardId.get(id);
  } catch {
    tcgdexDexIdsByCardId.set(id, undefined);
    return undefined;
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

  const inferred = inferEnglishNameFromTcgdexLocalizedName(trimmed);

  if (inferred) {
    rememberResolvedName(cacheKeys, inferred);
    return inferred;
  }

  if (trimmed) {
    const fromDatabase = await resolvePokemonNameToEnglish(trimmed, "ja");

    if (fromDatabase) {
      rememberResolvedName(cacheKeys, fromDatabase);
      return fromDatabase;
    }

    const override = JAPANESE_CARD_NAME_OVERRIDES[trimmed];

    if (override) {
      rememberResolvedName(cacheKeys, override);
      return override;
    }

    const { base, englishPrefix, englishSuffix } = parseJapaneseCardNameAffixes(trimmed);
    const baseOverride = JAPANESE_CARD_NAME_OVERRIDES[base];

    if (baseOverride) {
      const resolved = `${englishPrefix}${baseOverride}${englishSuffix}`;
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
      const englishParts = await Promise.all(
        parts.map(
          (part) =>
            Promise.resolve(JAPANESE_CARD_NAME_OVERRIDES[part]).then(
              (override) => override ?? resolvePokemonNameToEnglish(part, "ja"),
            ),
        ),
      );

      if (englishParts.length === parts.length && englishParts.every(Boolean)) {
        const resolved = `${englishPrefix}${englishParts.join(" & ")}${englishSuffix}`;
        rememberResolvedName(cacheKeys, resolved);
        return resolved;
      }
    }

    // Single species via the Japanese-aware base parser (catches suffixes the
    // English DB parser doesn't strip). DB-only, so it's safe even on the
    // local-data-only (skipTcgdex) path.
    if (base !== trimmed) {
      const englishBase = await resolvePokemonNameToEnglish(base, "ja");

      if (englishBase) {
        const resolved = `${englishPrefix}${englishBase}${englishSuffix}`;
        rememberResolvedName(cacheKeys, resolved);
        return resolved;
      }
    }
  }

  const dexId = input.dexIds?.find((id) => Number.isFinite(id) && id > 0);
  const fromDex = dexId ? resolveEnglishNameByDexId(dexId) : null;

  if (fromDex) {
    const { englishPrefix, englishSuffix } = trimmed
      ? parseJapaneseCardNameAffixes(trimmed)
      : { englishPrefix: "", englishSuffix: "" };
    const resolved = `${englishPrefix}${fromDex}${englishSuffix}`;
    rememberResolvedName(cacheKeys, resolved);
    return resolved;
  }

  if (!input.dexIds?.length) {
    return undefined;
  }

  rememberResolvedName(cacheKeys, undefined);
  return undefined;
}
