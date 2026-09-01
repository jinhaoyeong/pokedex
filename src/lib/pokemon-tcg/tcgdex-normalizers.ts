import { resolveLocalizedSetEnglishName } from "@/lib/localized-set-market";
import type {
  TcgdexCardBrief,
  TcgdexCardResponse,
  TcgdexEnglishCompanion,
  TcgdexSetResponse,
} from "@/lib/pokemon-tcg/api-types";
import {
  buildTcgdexSetIdCandidate,
  buildTcgdexSetIdCandidateFromEnglishSetId,
  normalizeWhitespace,
  resolveEnglishCompanionSetId,
  resolveLocalizedSetFilterId,
  LOCALIZED_SET_ID_ALIASES,
} from "@/lib/pokemon-tcg/text-and-collector-utils";
import {
  isPokemonTcgPocketPrint,
  isPokemonTcgPocketTcgdexUrl,
  stripPokemonTcgPocketFromTcgdexPayload,
} from "@/lib/pokemon-tcg/tcg-pocket";
import type { CardLanguageCode } from "@/types/pokemon";

export const TCGDEX_API_BASE_URL = "https://api.tcgdex.net/v2";

const LIVE_CATALOG_REVALIDATE_SECONDS = 3600;
const TCGDEX_DETAIL_CARD_TIMEOUT_MS = 2_500;
const LOCALIZED_SERIES_ASSET_ALIASES: Record<string, string> = {};

const TCGDEX_REQUEST_TIMEOUT_MS = 5_000;

export async function fetchTcgdexJson<T>(
  url: string,
  options: { revalidate?: number; timeoutMs?: number } = {},
): Promise<T> {
  if (isPokemonTcgPocketTcgdexUrl(url)) {
    throw new Error("Pokemon TCG Pocket is excluded from this catalog");
  }

  const response = await fetch(url, {
    next: { revalidate: options.revalidate ?? LIVE_CATALOG_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(options.timeoutMs ?? TCGDEX_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`TCGdex request failed: ${response.status}`);
  }

  return stripPokemonTcgPocketFromTcgdexPayload((await response.json()) as T);
}

export function normalizeTcgdexImageUrl(
  image?: string,
  quality: "high" | "low" = "high",
) {
  if (!image) {
    return null;
  }

  let cleanImage = image
    .trim()
    .replace(
      /^https:\/\/assets\.tcgdex\.net\/zh-cn\//i,
      "https://assets.tcgdex.net/zh-tw/",
    );

  if (!cleanImage) {
    return null;
  }

  if (/\.(png|webp|jpe?g)$/i.test(cleanImage)) {
    return cleanImage;
  }

  return `${cleanImage.replace(/\/$/, "")}/${quality}.webp`;
}

export function getTcgdexImageStatus(image?: string, companionImage?: string) {
  if (image) {
    return "official" as const;
  }

  if (companionImage) {
    return "derived" as const;
  }

  return "placeholder" as const;
}

export function getLocalizedSetEnglishName(setId: string, englishName?: string | null) {
  return resolveLocalizedSetEnglishName(setId, englishName ? normalizeWhitespace(englishName) : undefined);
}

export function buildTcgdexSetAssetPath({
  language,
  setId,
  serieId,
  localId,
}: {
  language: CardLanguageCode;
  setId: string;
  serieId?: string;
  localId: string;
}) {
  if (!serieId) {
    return null;
  }

  const assetSerieId = LOCALIZED_SERIES_ASSET_ALIASES[serieId] ?? serieId;

  return `https://assets.tcgdex.net/${language}/${assetSerieId}/${setId}/${localId}`;
}

export function resolveTcgdexAssetLanguage(language: CardLanguageCode): CardLanguageCode {
  if (language === "zh-cn") {
    return "zh-tw";
  }

  return language;
}

export function resolveTcgdexApiLanguage(language: CardLanguageCode): CardLanguageCode {
  if (language === "pt" || language === "pt-pt") {
    return "pt-br";
  }

  return language;
}

/** Set browse may fall back across Chinese locales when a code exists in only one catalog. */
export function tcgdexApiLanguageFallbacks(language: CardLanguageCode): CardLanguageCode[] {
  const primary = resolveTcgdexApiLanguage(language);

  if (language === "zh-cn") {
    return ["zh-cn", "zh-tw"];
  }

  return [primary];
}

export function buildEnglishCardIdCandidates(id: string) {
  const candidates = new Set<string>([id]);
  const separator = id.lastIndexOf("-");

  if (separator <= 0) {
    return [...candidates];
  }

  const setPart = id.slice(0, separator);
  const cardPart = id.slice(separator + 1);
  const tcgdxSetPart = buildTcgdexSetIdCandidate(setPart);

  candidates.add(`${tcgdxSetPart}-${cardPart}`);

  for (const [englishSetId, tcgdxSetId] of Object.entries(LOCALIZED_SET_ID_ALIASES.en ?? {})) {
    if (
      englishSetId === setPart ||
      tcgdxSetId === setPart ||
      tcgdxSetId === tcgdxSetPart
    ) {
      candidates.add(`${englishSetId}-${cardPart}`);
      candidates.add(`${tcgdxSetId}-${cardPart}`);
    }
  }

  return [...candidates];
}

export function buildLocalizedSetIdCandidates(
  language: CardLanguageCode,
  setFilter: string,
) {
  const resolved = resolveLocalizedSetFilterId(language, setFilter);
  const tcgdxCandidate =
    buildTcgdexSetIdCandidateFromEnglishSetId(setFilter) ??
    buildTcgdexSetIdCandidateFromEnglishSetId(resolved);
  const candidates = new Set<string>();

  // Prefer the TCGdex-padded English id (me5 → me05) so set browse does not
  // wait on a guaranteed 404 for the Pokemon TCG API id.
  if (tcgdxCandidate) {
    candidates.add(tcgdxCandidate);
    candidates.add(tcgdxCandidate.toUpperCase());
  }

  for (const value of [
    resolved,
    resolved.toUpperCase(),
    resolved.toLowerCase(),
    setFilter.trim(),
    setFilter.trim().toUpperCase(),
    setFilter.trim().toLowerCase(),
  ]) {
    if (value) {
      candidates.add(value);
    }
  }

  return [...candidates];
}

export function shouldDeriveTcgdexAsset(language: CardLanguageCode, serieId?: string | null) {
  if (!serieId) {
    return false;
  }

  const assetLanguage = resolveTcgdexAssetLanguage(language);
  const assetSerieId = LOCALIZED_SERIES_ASSET_ALIASES[serieId] ?? serieId;

  // Japanese SM-era assets.tcgdex.net paths routinely 404 (briefs omit `image`
  // and the derived /ja/SM/<set>/<id>/high.webp guess is empty). Prefer the
  // official pokemon-card.com browse seed instead of inventing dead URLs.
  if (assetLanguage === "ja") {
    return ["SV", "S", "XY", "BW", "SWSH"].includes(assetSerieId);
  }

  if (assetLanguage === "zh-tw") {
    return assetSerieId === "SV" || assetSerieId === "SM";
  }

  return false;
}

export function inferTcgdexSerieIdForAssets(setId: string): string | null {
  const id = setId.trim();
  const upper = id.toUpperCase();
  if (upper.startsWith("SM")) {
    return "SM";
  }
  if (upper.startsWith("DP")) {
    return "DP";
  }
  if (upper.startsWith("PL")) {
    return "PL";
  }
  if (upper.startsWith("BW")) {
    return "BW";
  }
  if (upper.startsWith("SVD")) {
    return "SV";
  }
  if (upper.startsWith("SV")) {
    return "SV";
  }
  if (/^S\d|^S[A-Z]/.test(upper)) {
    return "S";
  }
  if (/^M\d|^M[A-Z]/.test(upper)) {
    return "M";
  }
  if (/^swsh/i.test(id) || upper.startsWith("SWSH")) {
    return "SWSH";
  }
  if (upper.startsWith("XY")) {
    return "XY";
  }
  return null;
}

export function tryDeriveLocalizedTcgdexAsset(
  card: TcgdexCardResponse,
  language: CardLanguageCode,
): string | undefined {
  if (language === "en" || card.image) {
    return undefined;
  }
  const serieId = inferTcgdexSerieIdForAssets(card.set.id);
  if (!shouldDeriveTcgdexAsset(language, serieId)) {
    return undefined;
  }
  return (
    buildTcgdexSetAssetPath({
      language: resolveTcgdexAssetLanguage(language),
      setId: card.set.id,
      serieId: serieId ?? undefined,
      localId: card.localId,
    }) ?? undefined
  );
}

export function mergeTcgdexBriefIntoDetail(
  card: TcgdexCardResponse,
  brief?: TcgdexCardBrief,
  set?: TcgdexSetResponse | null,
  language?: CardLanguageCode,
): TcgdexCardResponse {
  const serieId = set?.serie?.id;
  const derivedImage =
    !card.image && set && language && shouldDeriveTcgdexAsset(language, serieId)
      ? buildTcgdexSetAssetPath({
          language: resolveTcgdexAssetLanguage(language),
          setId: set.id,
          serieId: serieId ?? undefined,
          localId: card.localId,
        })
      : undefined;
  const image = card.image ?? brief?.image ?? derivedImage ?? undefined;

  return {
    ...card,
    image,
    set: {
      ...card.set,
      cardCount: card.set.cardCount ?? set?.cardCount,
      name: card.set.name || set?.name || card.set.id,
    },
  };
}

export function getSetIdFromTcgdexCardId(cardId: string, localId?: string) {
  if (localId && cardId.endsWith(`-${localId}`)) {
    return cardId.slice(0, -(localId.length + 1));
  }

  const separatorIndex = cardId.lastIndexOf("-");
  return separatorIndex > 0 ? cardId.slice(0, separatorIndex) : "";
}

export async function fetchLocalizedCardFromEnglishBrief(
  brief: TcgdexCardBrief,
  language: CardLanguageCode,
): Promise<TcgdexCardResponse | null> {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const direct = await fetchTcgdexJson<TcgdexCardResponse>(
    `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${brief.id}`,
  ).catch(() => null);

  if (direct) {
    return direct;
  }

  const setId = getSetIdFromTcgdexCardId(brief.id, brief.localId);

  if (!setId) {
    return null;
  }

  const localizedSet = await fetchTcgdexJson<TcgdexSetResponse>(
    `${TCGDEX_API_BASE_URL}/${apiLanguage}/sets/${encodeURIComponent(setId)}`,
  ).catch(() => null);
  const localizedBrief = localizedSet?.cards?.find(
    (card) => card.localId.replace(/^0+(?=\d)/, "") === brief.localId.replace(/^0+(?=\d)/, ""),
  );

  if (!localizedBrief) {
    return null;
  }

  return fetchTcgdexJson<TcgdexCardResponse>(
    `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${localizedBrief.id}`,
  )
    .then((card) => mergeTcgdexBriefIntoDetail(card, localizedBrief, localizedSet, language))
    .catch(() => null);
}

export function getTcgdexCardImage({
  card,
  companion,
  derivedAssetBase,
}: {
  card: TcgdexCardResponse;
  companion: TcgdexEnglishCompanion;
  derivedAssetBase?: string | null;
}) {
  // 1. The real localized scan from the catalog, when TCGdex actually published
  //    one for this card.
  const officialImage = normalizeTcgdexImageUrl(card.image);

  if (officialImage) {
    return officialImage;
  }

  // 2. The real English companion scan. Preferred over the derived guess below
  //    because it is a verified URL: brand-new Japanese sets have no JA scans
  //    yet, so the derived JA asset path 404s while the English print exists.
  const companionImage = normalizeTcgdexImageUrl(companion.image);

  if (companionImage) {
    return companionImage;
  }

  // 3. Last resort: a guess derived from the localized asset path. Works for
  //    many sets whose briefs omit the URL but whose assets exist; if it 404s
  //    the client swaps in the placeholder.
  const derivedImage = normalizeTcgdexImageUrl(derivedAssetBase ?? undefined);

  if (derivedImage) {
    return derivedImage;
  }

  return "/icon.svg";
}

export async function fetchTcgdexDetailCardsFromBriefs(
  briefs: TcgdexCardBrief[],
  language: CardLanguageCode,
  options: { deadlineMs?: number; perCardTimeoutMs?: number } = {},
) {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const detailConcurrency = 14;
  const deadlineMs = options.deadlineMs;
  const perCardTimeoutMs = options.perCardTimeoutMs ?? TCGDEX_DETAIL_CARD_TIMEOUT_MS;
  const startedAt = Date.now();
  const detailed: TcgdexCardResponse[] = [];
  const physicalBriefs = briefs.filter(
    (brief) =>
      !isPokemonTcgPocketPrint({
        id: brief.id,
        image: brief.image,
      }),
  );

  for (let i = 0; i < physicalBriefs.length; i += detailConcurrency) {
    // Stop launching new chunks once the budget is spent; remaining briefs are
    // handled by the caller (brief-only fallback) so the request can't stall.
    if (deadlineMs && Date.now() - startedAt > deadlineMs) {
      break;
    }

    const chunk = physicalBriefs.slice(i, i + detailConcurrency);
    detailed.push(
      ...(await Promise.all(
        chunk.map((brief) =>
          Promise.race([
            fetchTcgdexJson<TcgdexCardResponse>(
              `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${brief.id}`,
            ).then((card) => mergeTcgdexBriefIntoDetail(card, brief, null, language)),
            new Promise<null>((resolve) => {
              setTimeout(() => resolve(null), perCardTimeoutMs);
            }),
          ]).catch(() => null),
        ),
      )).filter((card): card is TcgdexCardResponse => Boolean(card)),
    );
  }

  return detailed;
}

export function dedupeTcgdexBriefs(briefs: TcgdexCardBrief[]) {
  const seen = new Set<string>();

  return briefs.filter((brief) => {
    if (seen.has(brief.id)) {
      return false;
    }

    seen.add(brief.id);
    return true;
  });
}
