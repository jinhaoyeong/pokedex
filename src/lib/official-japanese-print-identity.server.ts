import "server-only";

import {
  japanesePrintedCollectorNumbersEqual,
  normalizeJapanesePrintedCollectorNumber,
} from "@/lib/japanese-market-identity";
import {
  findOfficialJapaneseBrowseSeedCandidatesBySetAndExactName,
  type OfficialJapaneseBrowseSeedMatch,
} from "@/lib/official-japanese-browse.server";
import { findJapaneseCardNameSearchAliases } from "@/lib/pokemon-name-db.server";
import { fetchOfficialJapaneseCardDetail } from "@/lib/pokemon-tcg/official-japanese-catalog";

const OFFICIAL_DETAIL_HYDRATION_CAP = 8;

export type OfficialJapanesePrintDisambiguation =
  | "unique_name"
  | "printed_number"
  | "ambiguous"
  | "none";

export type OfficialJapanesePrintResolution = {
  match: OfficialJapaneseBrowseSeedMatch | null;
  candidateOfficialCardIds: string[];
  disambiguation: OfficialJapanesePrintDisambiguation;
};

async function collectJapaneseNameAliases(names: Array<string | null | undefined>) {
  const aliases = new Set<string>();

  for (const name of names) {
    const trimmed = name?.trim();
    if (!trimmed) {
      continue;
    }
    aliases.add(trimmed);
    for (const alias of await findJapaneseCardNameSearchAliases(trimmed)) {
      aliases.add(alias);
    }
  }

  return [...aliases];
}

/**
 * Resolve a Japanese official card ID from set + name + printed number.
 * Never picks browse order when several same-name prints exist.
 */
export async function resolveOfficialJapaneseBrowseMatchForMarket(input: {
  setCode?: string | null;
  names: Array<string | null | undefined>;
  printedCollectorNumber?: string | null;
}): Promise<OfficialJapanesePrintResolution> {
  const aliases = await collectJapaneseNameAliases(input.names);
  const candidates = findOfficialJapaneseBrowseSeedCandidatesBySetAndExactName(
    input.setCode ?? undefined,
    aliases,
  );
  const candidateOfficialCardIds = [
    ...new Set(candidates.map((candidate) => candidate.item.cardID)),
  ];

  if (!candidates.length) {
    return { match: null, candidateOfficialCardIds: [], disambiguation: "none" };
  }

  if (candidates.length === 1) {
    return {
      match: candidates[0],
      candidateOfficialCardIds,
      disambiguation: "unique_name",
    };
  }

  const printed = normalizeJapanesePrintedCollectorNumber(input.printedCollectorNumber);
  if (!printed) {
    return { match: null, candidateOfficialCardIds, disambiguation: "ambiguous" };
  }

  const details = await Promise.all(
    candidates.slice(0, OFFICIAL_DETAIL_HYDRATION_CAP).map(async (candidate) => ({
      candidate,
      detail: await fetchOfficialJapaneseCardDetail(candidate.item.cardID, candidate.item).catch(
        () => null,
      ),
    })),
  );

  const printedMatches = details.filter(
    ({ detail }) =>
      detail &&
      detail.collectorNumberSource === "official-detail" &&
      japanesePrintedCollectorNumbersEqual(detail.collectorNumber, printed),
  );

  if (printedMatches.length === 1) {
    return {
      match: printedMatches[0].candidate,
      candidateOfficialCardIds,
      disambiguation: "printed_number",
    };
  }

  return { match: null, candidateOfficialCardIds, disambiguation: "ambiguous" };
}
