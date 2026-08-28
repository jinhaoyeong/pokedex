import { normalizeSearchText, normalizeSetCode } from "@/lib/pokemon-tcg/text-and-collector-utils";
import type { SearchResult, TcgCard } from "@/types/pokemon";

function normalizedCollectorNumber(value: string) {
  return value.trim().replace(/^0+(?=\d)/, "");
}

function setIdentityKey(card: TcgCard) {
  return normalizeSetCode(card.setCode || card.setId || "");
}

function cardNameKeys(card: TcgCard) {
  return [
    ...new Set(
      [card.localizedName, card.englishName, card.name]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeSearchText(value)),
    ),
  ];
}

export function cardsShareJapaneseNameSetIdentity(left: TcgCard, right: TcgCard) {
  if (!setIdentityKey(left) || setIdentityKey(left) !== setIdentityKey(right)) {
    return false;
  }

  const rightNames = new Set(cardNameKeys(right));
  return cardNameKeys(left).some((name) => rightNames.has(name));
}

function overlayOfficialCollectorNumber(official: TcgCard, tcgdex: TcgCard): TcgCard {
  const collectorNumber =
    normalizedCollectorNumber(tcgdex.collectorNumber) || official.collectorNumber;

  return {
    ...official,
    collectorNumber,
    setPrintedTotal: official.setPrintedTotal ?? tcgdex.setPrintedTotal,
    setTotal: official.setTotal ?? tcgdex.setTotal,
    marketIdentity: official.marketIdentity
      ? {
          ...official.marketIdentity,
          printedCollectorNumber:
            official.marketIdentity.printedCollectorNumber || collectorNumber || null,
          collectorNumberTotal:
            official.marketIdentity.collectorNumberTotal ??
            tcgdex.setPrintedTotal ??
            tcgdex.setTotal ??
            null,
        }
      : official.marketIdentity,
  };
}

/**
 * Official Japanese browse seeds omit printed numbers. Match TCGdex rows by
 * set+name, copy a collector number only when that match is unique, and drop
 * the duplicate tile.
 */
export function mergeOfficialJapaneseAndTcgdexNameResults(
  officialResults: SearchResult[],
  tcgdexResults: SearchResult[],
): SearchResult[] {
  const usedTcgdexIds = new Set<string>();
  const dropOfficialIds = new Set<string>();

  const hydratedOfficial = officialResults.map((official) => {
    const matches = tcgdexResults.filter((candidate) =>
      cardsShareJapaneseNameSetIdentity(official.card, candidate.card),
    );
    const officialNumber = normalizedCollectorNumber(official.card.collectorNumber);
    const exact = matches.find(
      (candidate) =>
        Boolean(officialNumber) &&
        normalizedCollectorNumber(candidate.card.collectorNumber) === officialNumber,
    );

    if (exact) {
      usedTcgdexIds.add(exact.card.id);
      return official;
    }

    const numberedMatches = matches.filter((candidate) =>
      Boolean(normalizedCollectorNumber(candidate.card.collectorNumber)),
    );

    if (!officialNumber && numberedMatches.length === 1) {
      usedTcgdexIds.add(numberedMatches[0].card.id);
      return {
        ...official,
        card: overlayOfficialCollectorNumber(official.card, numberedMatches[0].card),
      };
    }

    const officialGroup = officialResults.filter((candidate) =>
      cardsShareJapaneseNameSetIdentity(official.card, candidate.card),
    );

    if (
      !officialNumber &&
      numberedMatches.length > 1 &&
      officialGroup.length === 1
    ) {
      dropOfficialIds.add(official.card.id);
    }

    return official;
  });

  const keptOfficial = hydratedOfficial.filter(
    (result) => !dropOfficialIds.has(result.card.id),
  );

  const keptTcgdex = tcgdexResults.filter((tcgdex) => {
    if (usedTcgdexIds.has(tcgdex.card.id)) {
      return false;
    }

    const overlappingOfficial = keptOfficial.filter((official) =>
      cardsShareJapaneseNameSetIdentity(official.card, tcgdex.card),
    );

    if (!overlappingOfficial.length) {
      return true;
    }

    const tcgdexNumber = normalizedCollectorNumber(tcgdex.card.collectorNumber);
    if (
      tcgdexNumber &&
      overlappingOfficial.some(
        (official) =>
          normalizedCollectorNumber(official.card.collectorNumber) === tcgdexNumber,
      )
    ) {
      return false;
    }

    if (
      overlappingOfficial.every(
        (official) => !normalizedCollectorNumber(official.card.collectorNumber),
      )
    ) {
      return false;
    }

    return true;
  });

  return [...keptOfficial, ...keptTcgdex].filter(
    (result, index, items) =>
      items.findIndex((candidate) => candidate.card.id === result.card.id) === index,
  );
}
