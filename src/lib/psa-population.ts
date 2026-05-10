import type { PsaPopulationSnapshot, TcgCard } from "@/types/pokemon";

const TARGET_GRADES = new Set(["PSA 9", "PSA 10"]);

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripHtmlToText(input: string) {
  return input
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function splitCandidateLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitRowTokens(line: string) {
  if (line.includes("\t")) {
    return line
      .split("\t")
      .map((token) => token.trim())
      .filter(Boolean);
  }

  if (line.includes("|")) {
    return line
      .split("|")
      .map((token) => token.trim())
      .filter(Boolean);
  }

  return line
    .split(/\s{2,}/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function findBestMatchingLine(lines: string[], card: Pick<TcgCard, "collectorNumber" | "name">) {
  const normalizedNumber = normalizeText(card.collectorNumber);
  const normalizedName = normalizeText(card.name);
  const nameWords = normalizedName.split(" ").filter((word) => word.length > 2);

  return (
    lines.find((line) => {
      const normalizedLine = normalizeText(line);
      return (
        normalizedLine.includes(normalizedNumber) &&
        nameWords.some((word) => normalizedLine.includes(word))
      );
    }) ?? null
  );
}

function extractTrailingNumericTokens(tokens: string[]) {
  return tokens
    .map((token) => token.replace(/,/g, ""))
    .filter((token) => /^\d+$/.test(token))
    .map((token) => Number.parseInt(token, 10));
}

export function getPrimaryPsaPopulationLabel(snapshot: PsaPopulationSnapshot) {
  const psa10 = snapshot.grades.find((grade) => grade.grade === "PSA 10");

  if (psa10) {
    return `PSA 10 Pop ${psa10.count.toLocaleString()}`;
  }

  const psa9 = snapshot.grades.find((grade) => grade.grade === "PSA 9");

  if (psa9) {
    return `PSA 9 Pop ${psa9.count.toLocaleString()}`;
  }

  if (typeof snapshot.totalCertified === "number") {
    return `PSA Total ${snapshot.totalCertified.toLocaleString()}`;
  }

  return "PSA pop pending";
}

export function mergePsaPopulationSnapshot(
  base: PsaPopulationSnapshot,
  override?: PsaPopulationSnapshot | null,
) {
  if (!override || override.status !== "verified") {
    return base;
  }

  return {
    ...base,
    ...override,
    grades: override.grades
      .filter((grade) => TARGET_GRADES.has(grade.grade))
      .sort((left, right) => right.grade.localeCompare(left.grade)),
  };
}

export function createManualPsaPopulationSnapshot(input: {
  psa9: number;
  psa10: number;
  totalCertified: number;
  sourceUrl?: string;
}): PsaPopulationSnapshot {
  return {
    status: "verified",
    totalCertified: input.totalCertified,
    grades: [
      { grade: "PSA 10", count: input.psa10 },
      { grade: "PSA 9", count: input.psa9 },
    ],
    source: "Manual PSA import",
    fetchedAt: new Date().toISOString(),
    sourceUrl: input.sourceUrl?.trim() ? input.sourceUrl.trim() : undefined,
    note: "Imported from the official PSA population report by pasted table data.",
  };
}

export function parsePsaPopulationInput(
  rawInput: string,
  card: Pick<TcgCard, "collectorNumber" | "name">,
) {
  const sanitizedInput = stripHtmlToText(rawInput);
  const lines = splitCandidateLines(sanitizedInput);
  const matchingLine = findBestMatchingLine(lines, card);

  if (!matchingLine) {
    return {
      success: false as const,
      error:
        "No PSA row matched this card. Copy the exact row for this card from the official PSA pop table and paste it here.",
    };
  }

  const tokens = splitRowTokens(matchingLine);
  const numbers = extractTrailingNumericTokens(tokens);

  if (numbers.length < 3) {
    return {
      success: false as const,
      error:
        "The pasted PSA row did not contain enough numeric columns. Copy the row directly from the table so the grade columns stay intact.",
    };
  }

  const [psa9, psa10, totalCertified] = numbers.slice(-3);

  if (totalCertified < psa10 || totalCertified < psa9) {
    return {
      success: false as const,
      error:
        "The parsed totals look invalid. Check that you copied only the matching PSA row and not extra page text.",
    };
  }

  return {
    success: true as const,
    matchedLine: matchingLine,
    parsed: {
      psa9,
      psa10,
      totalCertified,
    },
  };
}
