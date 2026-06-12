export type FeedbackIssueType =
  | "wrong_price"
  | "wrong_grade_price"
  | "wrong_card"
  | "wrong_set"
  | "wrong_number"
  | "wrong_name"
  | "missing_data"
  | "other";

export type ParsedCardFeedback = {
  issueType: FeedbackIssueType;
  field: "price" | "identity";
  reportedValue?: string;
  note: string;
  extracted: {
    priceUsd?: number;
    grade?: string;
    cardName?: string;
    setName?: string;
    collectorNumber?: string;
    printedTotal?: number;
    slug?: string;
  };
  confidence: "high" | "medium" | "low";
  summary: string;
  learningActions: string[];
};

export const FEEDBACK_ISSUE_OPTIONS: Array<{
  value: FeedbackIssueType;
  label: string;
  hint: string;
}> = [
  {
    value: "wrong_price",
    label: "Market price",
    hint: "Headline price looks off — we'll recheck comps and guides",
  },
  {
    value: "wrong_grade_price",
    label: "Grade price",
    hint: "A slab grade value looks off — we'll recheck that grade",
  },
  {
    value: "wrong_card",
    label: "Wrong card",
    hint: "This page may not match what you searched for",
  },
  {
    value: "wrong_set",
    label: "Wrong set",
    hint: "Set or expansion may be mismatched",
  },
  {
    value: "wrong_number",
    label: "Wrong number",
    hint: "Collector number may not match",
  },
  {
    value: "wrong_name",
    label: "Wrong name",
    hint: "Card name or translation may be off",
  },
  {
    value: "missing_data",
    label: "Missing data",
    hint: "Price, grade, or population may be missing from sources",
  },
  {
    value: "other",
    label: "Something else",
    hint: "Another issue worth reviewing",
  },
];

const GRADE_PATTERN =
  /\b((?:PSA|BGS|CGC|SGC|TAG)\s*(?:10\s*(?:Black|Pristine)|\d+(?:\.\d+)?)|Ungraded|Raw)\b/i;

const SLUG_PATTERN = /\b([a-z]{2,12}(?:pt5|pt)?[-_][\w-]+)\b/i;

function parseUsdAmount(value: string | undefined) {
  if (!value?.trim()) {
    return undefined;
  }

  const normalized = value.replace(/,/g, "").trim();
  const match = normalized.match(/(\d+(?:\.\d{1,2})?)/);

  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[1]);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function parseGrade(value: string | undefined) {
  if (!value?.trim()) {
    return undefined;
  }

  const direct = value.trim().match(GRADE_PATTERN);

  if (direct) {
    return direct[1].replace(/\s+/g, " ").trim();
  }

  return undefined;
}

function parseCollectorNumber(value: string | undefined) {
  if (!value?.trim()) {
    return undefined;
  }

  const slashMatch = value.trim().match(/(\d{1,4})\s*\/\s*(\d{1,4})/);

  if (slashMatch) {
    return {
      collectorNumber: slashMatch[1],
      printedTotal: Number.parseInt(slashMatch[2], 10),
    };
  }

  const hashMatch = value.trim().match(/#?\s*(\d{1,4})/);

  if (hashMatch) {
    return { collectorNumber: hashMatch[1] };
  }

  return undefined;
}

function extractFromNote(note: string) {
  const priceMatch = note.match(
    /(?:should be|expected|actually|around|about|~)\s*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/i,
  );
  const grade = parseGrade(note);
  const collector = parseCollectorNumber(note);
  const slugMatch = note.match(SLUG_PATTERN);
  const setMatch = note.match(
    /\b(?:set|expansion|from)\s+(?:is\s+)?["']?([A-Za-z0-9][A-Za-z0-9\s.'\-:&]+?)["']?(?:\s|$|,|\.)/i,
  );
  const nameMatch = note.match(
    /\b(?:should be|actually|name is|called)\s+["']?([A-Za-z][A-Za-z0-9\s.'\-]+?)["']?(?:\s|$|,|\.)/i,
  );

  return {
    priceUsd: priceMatch ? parseUsdAmount(priceMatch[1]) : undefined,
    grade,
    collectorNumber: collector?.collectorNumber,
    printedTotal: collector?.printedTotal,
    slug: slugMatch?.[1],
    setName: setMatch?.[1]?.trim(),
    cardName: nameMatch?.[1]?.trim(),
  };
}

function fieldForIssue(issueType: FeedbackIssueType): "price" | "identity" {
  return issueType === "wrong_price" ||
    issueType === "wrong_grade_price" ||
    issueType === "missing_data"
    ? "price"
    : "identity";
}

function buildReportedValue(parsed: ParsedCardFeedback["extracted"], issueType: FeedbackIssueType) {
  if (parsed.priceUsd !== undefined) {
    return parsed.grade
      ? `${parsed.grade}:${parsed.priceUsd.toFixed(2)}`
      : parsed.priceUsd.toFixed(2);
  }

  if (parsed.slug) {
    return parsed.slug;
  }

  if (issueType === "wrong_number" && parsed.collectorNumber) {
    return parsed.printedTotal
      ? `${parsed.collectorNumber}/${parsed.printedTotal}`
      : parsed.collectorNumber;
  }

  if (issueType === "wrong_set" && parsed.setName) {
    return parsed.setName;
  }

  if ((issueType === "wrong_name" || issueType === "wrong_card") && parsed.cardName) {
    return parsed.cardName;
  }

  if (parsed.grade) {
    return parsed.grade;
  }

  return undefined;
}

function scoreConfidence(
  issueType: FeedbackIssueType,
  extracted: ParsedCardFeedback["extracted"],
  note: string,
) {
  const hasStructured =
    extracted.priceUsd !== undefined ||
    Boolean(extracted.grade) ||
    Boolean(extracted.cardName) ||
    Boolean(extracted.setName) ||
    Boolean(extracted.collectorNumber) ||
    Boolean(extracted.slug);

  if (hasStructured) {
    return "high" as const;
  }

  if (note.trim().length >= 12) {
    return "medium" as const;
  }

  if (issueType === "other") {
    return "low" as const;
  }

  return "medium" as const;
}

function buildLearningActions(
  issueType: FeedbackIssueType,
  extracted: ParsedCardFeedback["extracted"],
): string[] {
  const actions: string[] = [
    "Store your note as a review hint only — displayed prices stay source-backed until rechecked",
  ];

  if (extracted.priceUsd !== undefined) {
    actions.push(
      extracted.grade
        ? `Recheck ${extracted.grade} comps and guides; your ~$${extracted.priceUsd.toFixed(2)} estimate helps focus the review`
        : `Recheck market comps and guides; your ~$${extracted.priceUsd.toFixed(2)} estimate helps focus the review`,
    );
  }

  if (extracted.grade && extracted.priceUsd === undefined) {
    actions.push(`Review ${extracted.grade} pricing from sold listings and catalog sources`);
  }

  if (extracted.collectorNumber) {
    actions.push(
      extracted.printedTotal
        ? `Verify collector number ${extracted.collectorNumber}/${extracted.printedTotal} against official set lists`
        : `Verify collector number ${extracted.collectorNumber} against official set lists`,
    );
  }

  if (extracted.setName) {
    actions.push(`Cross-check set identity against catalogs using hint "${extracted.setName}"`);
  }

  if (extracted.cardName) {
    actions.push(`Cross-check card identity against catalogs using hint "${extracted.cardName}"`);
  }

  if (extracted.slug) {
    actions.push(`Compare this page with slug hint ${extracted.slug} during identity review`);
  }

  if (issueType === "missing_data") {
    actions.push("Prioritize a fresh pull from market and catalog sources for missing fields");
  }

  actions.push("Schedule a background refresh from live sources");

  return actions;
}

function buildSummary(
  issueType: FeedbackIssueType,
  extracted: ParsedCardFeedback["extracted"],
  note: string,
) {
  const label = FEEDBACK_ISSUE_OPTIONS.find((option) => option.value === issueType)?.label ?? "Issue";

  if (extracted.priceUsd !== undefined && extracted.grade) {
    return `${label}: review hint — ${extracted.grade} may be closer to ~$${extracted.priceUsd.toFixed(2)}`;
  }

  if (extracted.priceUsd !== undefined) {
    return `${label}: review hint — price may be closer to ~$${extracted.priceUsd.toFixed(2)}`;
  }

  if (extracted.collectorNumber && extracted.printedTotal) {
    return `${label}: review hint — check #${extracted.collectorNumber}/${extracted.printedTotal}`;
  }

  if (extracted.collectorNumber) {
    return `${label}: review hint — check #${extracted.collectorNumber}`;
  }

  if (extracted.setName) {
    return `${label}: review hint — set may be "${extracted.setName}"`;
  }

  if (extracted.cardName) {
    return `${label}: review hint — name may be "${extracted.cardName}"`;
  }

  if (extracted.slug) {
    return `${label}: review hint — compare with ${extracted.slug}`;
  }

  if (extracted.grade) {
    return `${label}: review ${extracted.grade} values from sources`;
  }

  if (note.trim()) {
    return `${label}: ${note.trim().slice(0, 96)}${note.trim().length > 96 ? "…" : ""}`;
  }

  return `${label} queued for source review`;
}

export function parseCardFeedback(input: {
  issueType: FeedbackIssueType;
  note?: string;
  expectedPrice?: string;
  expectedGrade?: string;
  correctName?: string;
  correctSet?: string;
  correctNumber?: string;
}): ParsedCardFeedback {
  const note = input.note?.trim() ?? "";
  const fromNote = extractFromNote(note);
  const collector = parseCollectorNumber(input.correctNumber);

  const extracted = {
    priceUsd: parseUsdAmount(input.expectedPrice) ?? fromNote.priceUsd,
    grade: parseGrade(input.expectedGrade) ?? parseGrade(note) ?? fromNote.grade,
    cardName: input.correctName?.trim() || fromNote.cardName,
    setName: input.correctSet?.trim() || fromNote.setName,
    collectorNumber: collector?.collectorNumber ?? fromNote.collectorNumber,
    printedTotal: collector?.printedTotal ?? fromNote.printedTotal,
    slug: fromNote.slug,
  };

  const field = fieldForIssue(input.issueType);
  const reportedValue = buildReportedValue(extracted, input.issueType);
  const confidence = scoreConfidence(input.issueType, extracted, note);
  const learningActions = buildLearningActions(input.issueType, extracted);
  const summary = buildSummary(input.issueType, extracted, note);

  return {
    issueType: input.issueType,
    field,
    reportedValue,
    note,
    extracted,
    confidence,
    summary,
    learningActions,
  };
}
