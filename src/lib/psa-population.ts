import type {
  GradedPrice,
  GradingService,
  MarketConfidence,
  PricePoint,
  PsaPopulationSnapshot,
  SaleRecord,
  TcgCard,
} from "@/types/pokemon";

const PUBLIC_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const GRADING_KEYWORDS =
  /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|GRADED|SLAB|BLACK LABEL|PRISTINE|GEM MINT|AUTHENTIC)\b/i;

const WHOLE_GRADES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;
const HALF_GRADES = ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5.5", "5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1"] as const;
const PSA_GRADES = WHOLE_GRADES.map((grade) => `PSA ${grade}`);
const BGS_GRADES = [
  "BGS 10 Black",
  ...HALF_GRADES.map((grade) => `BGS ${grade}`),
];
const CGC_GRADES = ["CGC 10 Pristine", ...HALF_GRADES.map((grade) => `CGC ${grade}`)];
const SGC_GRADES = HALF_GRADES.map((grade) => `SGC ${grade}`);
const TAG_GRADES = WHOLE_GRADES.map((grade) => `TAG ${grade}`);

const SOLD_COMP_GRADES = [
  "Ungraded",
  ...PSA_GRADES,
  ...BGS_GRADES,
  ...CGC_GRADES,
  ...SGC_GRADES,
  ...TAG_GRADES,
] as const;

function slugify(text: string) {
  return text
    .replace(/Γÿà|γÿà|â˜…|â˜†|★|☆/g, " star ")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "-s")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function priceChartingSlugify(text: string) {
  return slugify(text).replace(/-star\b/g, "-gold-star");
}

function numberSlugVariantsForExternalApis(collectorNumber: string): string[] {
  const raw = collectorNumber.trim();
  const primary = slugify(raw.replace(/^0+/, ""));
  const parts = raw.split("/").map((part) => part.trim()).filter(Boolean);
  const variants = new Set<string>([primary]);

  if (parts.length === 2) {
    const a = parts[0].replace(/^0+/, "") || "0";
    const b = parts[1].replace(/^0+/, "") || "0";
    const flipped = slugify(`${b}/${a}`);
    variants.add(slugify(`${a}/${b}`));

    if (flipped !== primary) {
      variants.add(flipped);
    }
  }

  return [...variants];
}

function buildPriceChartingGameUrl(
  setName: string,
  cardName: string,
  collectorNumberSlug: string,
) {
  const setSlug = `pokemon-${priceChartingSlugify(setName)}`;
  const nameSlug = priceChartingSlugify(cardName);

  return `https://www.pricecharting.com/game/${setSlug}/${nameSlug}-${collectorNumberSlug}`;
}

function buildTcgFishCardUrl(setSlug: string, nameSlug: string, collectorNumberSlug: string) {
  return `https://www.tcgfish.net/pokemon-set/${setSlug}/${nameSlug}-${collectorNumberSlug}`;
}

function isLikelyBotWallHtml(html: string) {
  return html.length < 12_000 && /\bjust a moment\b/i.test(html);
}

function pendingPsaPopulation(url: string, note: string): PsaPopulationSnapshot {
  return {
    status: "pending",
    totalCertified: null,
    grades: [],
    source: "Population source unavailable",
    fetchedAt: new Date().toISOString(),
    sourceUrl: url,
    note,
    service: "PSA",
    confidence: "low",
    confidenceScore: 0.2,
    evidenceType: "population",
    warning: "Population source did not expose usable counts.",
  };
}

function gradeService(grade: string): GradingService {
  if (grade === "Ungraded") return "RAW";
  if (grade.startsWith("PSA")) return "PSA";
  if (grade.startsWith("BGS") || grade.startsWith("BECKETT")) return "BGS";
  if (grade.startsWith("CGC")) return "CGC";
  if (grade.startsWith("SGC")) return "SGC";
  if (grade.startsWith("TAG")) return "TAG";
  return "RAW";
}

function confidenceFromScore(score: number): MarketConfidence {
  if (score >= 0.78) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function soldCompConfidence(sales: SaleRecord[], snapshot?: GradedPrice) {
  const saleCount = sales.length;
  const hasSnapshot = Boolean(snapshot?.value && snapshot.value > 0);
  const score = Math.min(
    0.95,
    saleCount >= 6 ? 0.9 : saleCount >= 3 ? 0.78 : saleCount >= 2 ? 0.62 : hasSnapshot ? 0.48 : 0.34,
  );

  return {
    confidence: confidenceFromScore(score),
    confidenceScore: score,
  };
}

function guideConfidence(source?: string) {
  const score = source?.includes("TCGFish") ? 0.58 : 0.52;
  return {
    confidence: confidenceFromScore(score),
    confidenceScore: score,
  };
}

function robustMedian(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const baseline = median(values);
  const filtered = values.filter((value) => value >= baseline / 2.8 && value <= baseline * 2.8);
  return median(filtered.length ? filtered : values);
}

function reconcileSoldPriceWithSnapshot(sales: SaleRecord[], snapshot: GradedPrice | undefined) {
  const compMedian = robustMedian(sales.map((sale) => sale.price));

  if (!snapshot?.value || !Number.isFinite(snapshot.value) || snapshot.value <= 0) {
    return compMedian;
  }

  const n = sales.length;

  if (n >= 6) {
    return compMedian;
  }

  const towardSnapshot = n <= 1 ? 0.42 : n === 2 ? 0.32 : 0.22;
  return compMedian * (1 - towardSnapshot) + snapshot.value * towardSnapshot;
}

const CATALOG_CHART_LABELS = ["30d", "7d", "1d", "trend", "now"] as const;

function chartTimelineSortKey(date: string): number {
  const catalogIndex = CATALOG_CHART_LABELS.indexOf(date as (typeof CATALOG_CHART_LABELS)[number]);

  if (catalogIndex >= 0) {
    return 1_000_000_000_000 + catalogIndex;
  }

  const parsed = Date.parse(date);

  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  return 1_000_000_000_900;
}

export function mergePriceHistoryWithCatalog(
  catalog: PricePoint[],
  salesBased: PricePoint[],
): PricePoint[] {
  if (!salesBased.length) {
    return catalog;
  }

  if (!catalog.length) {
    return salesBased;
  }

  const merged = new Map<string, PricePoint>();

  for (const point of catalog) {
    merged.set(point.date, {
      date: point.date,
      value: point.value,
      gradeValues: { Ungraded: point.value, ...point.gradeValues },
    });
  }

  for (const point of salesBased) {
    const existing = merged.get(point.date);

    if (existing) {
      merged.set(point.date, {
        date: point.date,
        value:
          typeof point.gradeValues?.Ungraded === "number"
            ? point.gradeValues.Ungraded
            : (point.value ?? existing.value),
        gradeValues: { ...existing.gradeValues, ...point.gradeValues },
      });
    } else {
      merged.set(point.date, point);
    }
  }

  return [...merged.values()].sort(
    (left, right) => chartTimelineSortKey(left.date) - chartTimelineSortKey(right.date),
  );
}

function normalizeCardName(text: string) {
  return text
    .replace(/Γÿà|γÿà|â˜…|â˜†|★|☆/g, " Star ")
    .normalize("NFKD")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeWhitespace(text: string) {
  return normalizeCardName(decodeHtmlEntities(text)).replace(/\s+/g, " ").trim();
}

function stripHtml(text: string) {
  return normalizeWhitespace(text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function toAbsoluteUrl(path: string) {
  if (path.startsWith("http")) {
    return path;
  }

  return `https://magery.com${path}`;
}

function parseUsd(value: string) {
  return Number.parseFloat(value.replace(/[^0-9.]/g, ""));
}

function gradeTokenRegex(grade: string | number) {
  return String(grade).replace(".", "\\.?");
}

function hasServiceGrade(title: string, servicePattern: string, grade: string | number) {
  const token = gradeTokenRegex(grade);
  const serviceThenGrade = new RegExp(`\\b${servicePattern}\\b[\\s:#-]{0,10}\\b${token}\\b`, "i");
  const gradeThenService = new RegExp(`\\b${token}\\b[\\s:#-]{0,10}\\b${servicePattern}\\b`, "i");

  return serviceThenGrade.test(title) || gradeThenService.test(title);
}

function hasBadSaleTitleSignals(title: string) {
  return /\b(lot|bundle|collection|pack|packs|box|booster|case|set of|mystery|proxy|reprint|custom|digital|code card)\b/i.test(title);
}

function tokenizeForMatching(text: string) {
  return normalizeCardName(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function toIsoDate(label: string) {
  const date = new Date(label);

  if (Number.isNaN(date.getTime())) {
    return label;
  }

  return date.toISOString().slice(0, 10);
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function matchesCondition(title: string, condition: string) {
  const normalizedTitle = title.toUpperCase();

  if (condition === "Ungraded") {
    return !GRADING_KEYWORDS.test(normalizedTitle);
  }

  const gradeMatch = condition.match(/^(PSA|BGS|CGC|SGC|TAG)\s+(\d+(?:\.5)?)/);

  if (gradeMatch) {
    const [, service, grade] = gradeMatch;
    const servicePattern = service === "BGS" ? "(?:BGS|BECKETT)" : service;

    if (!hasServiceGrade(normalizedTitle, servicePattern, grade)) {
      return false;
    }

    if (condition === "BGS 10") {
      return !/BLACK\s+LABEL|BLACK\b/i.test(normalizedTitle);
    }

    if (condition === "CGC 10") {
      return !/PRIST/i.test(normalizedTitle);
    }

    return true;
  }

  if (condition === "BGS 10 Black") {
    return /\b(BGS|BECKETT)\b/.test(normalizedTitle) && /BLACK\s+LABEL|BLACK\b/i.test(normalizedTitle);
  }

  if (condition === "BGS 10") {
    return (
      /\b(BGS|BECKETT)\b/.test(normalizedTitle) &&
      /\b10\b/.test(normalizedTitle) &&
      !/BLACK\s+LABEL|BLACK\b/i.test(normalizedTitle)
    );
  }

  if (condition === "BGS 9.5") {
    return /\b(BGS|BECKETT)\b/.test(normalizedTitle) && /\b9\.?5\b/.test(normalizedTitle);
  }

  if (condition === "CGC 10 Pristine") {
    return /\bCGC\b/.test(normalizedTitle) && /\b10\b/.test(normalizedTitle) && /PRIST/i.test(normalizedTitle);
  }

  if (condition === "CGC 10") {
    return (
      /\bCGC\b/.test(normalizedTitle) &&
      /\b10\b/.test(normalizedTitle) &&
      !/PRIST/i.test(normalizedTitle)
    );
  }

  if (condition === "CGC 9.5") {
    return /\bCGC\b/.test(normalizedTitle) && /\b9\.?5\b/.test(normalizedTitle);
  }

  if (condition === "TAG 10") {
    return /\bTAG\b/.test(normalizedTitle) && /\b10\b/.test(normalizedTitle);
  }

  if (condition === "SGC 10") {
    return /\bSGC\b/.test(normalizedTitle) && /\b10\b/.test(normalizedTitle);
  }

  return normalizedTitle.includes(condition.toUpperCase());
}

function detectSaleCondition(title: string) {
  const normalizedTitle = title.toUpperCase();

  for (const grade of WHOLE_GRADES) {
    if (hasServiceGrade(normalizedTitle, "PSA", grade)) {
      return `PSA ${grade}`;
    }
  }

  if (/\b(BGS|BECKETT)\b/.test(normalizedTitle) && /BLACK\s+LABEL|BLACK\b/i.test(normalizedTitle))
    return "BGS 10 Black";

  for (const grade of HALF_GRADES) {
    if (hasServiceGrade(normalizedTitle, "(?:BGS|BECKETT)", grade)) {
      return `BGS ${grade}`;
    }
  }

  if (/\bCGC\b/.test(normalizedTitle) && /\b10\b/.test(normalizedTitle) && /PRIST/i.test(normalizedTitle))
    return "CGC 10 Pristine";

  for (const grade of HALF_GRADES) {
    if (hasServiceGrade(normalizedTitle, "CGC", grade)) {
      return `CGC ${grade}`;
    }

    if (hasServiceGrade(normalizedTitle, "SGC", grade)) {
      return `SGC ${grade}`;
    }
  }

  for (const grade of WHOLE_GRADES) {
    if (hasServiceGrade(normalizedTitle, "TAG", grade)) {
      return `TAG ${grade}`;
    }

  }

  return "Ungraded";
}

function isRelevantSaleTitle(
  title: string,
  cardName: string,
  cardNumber: string,
  setName: string,
) {
  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const setTokens = tokenizeForMatching(setName).filter((token) => token.length > 2);
  const cardNumberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;

  const nameMatchCount = nameTokens.filter((token) => titleTokens.has(token)).length;
  const hasCardNumber =
    titleTokens.has(cardNumber.toLowerCase()) || titleTokens.has(cardNumberBase.toLowerCase());
  const hasSetSignal = setTokens.some((token) => titleTokens.has(token));

  return (nameMatchCount >= Math.min(2, nameTokens.length) && hasCardNumber) || (nameMatchCount >= 2 && hasSetSignal);
}

function extractCollectorNumbers(title: string) {
  return [...title.matchAll(/\b(\d{1,3}(?:\/\d{1,3})?)\b/g)].map((match) => match[1].toLowerCase());
}

function scoreSaleTitle(
  title: string,
  cardName: string,
  cardNumber: string,
  setName: string,
) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const setTokens = tokenizeForMatching(setName).filter((token) => token.length > 2);
  const cardNumberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const collectorNumbers = extractCollectorNumbers(normalizedTitle);
  let score = 0;

  score += nameTokens.filter((token) => titleTokens.has(token)).length * 4;

  if (collectorNumbers.includes(cardNumber.toLowerCase())) {
    score += 8;
  } else if (collectorNumbers.includes(cardNumberBase.toLowerCase())) {
    score += 6;
  } else if (collectorNumbers.length) {
    score -= 6;
  }

  const matchedSetTokens = setTokens.filter((token) => titleTokens.has(token)).length;
  score += matchedSetTokens * 2;

  if (normalizedTitle.includes(normalizeCardName(setName).toLowerCase())) {
    score += 4;
  }

  const conflictPhrases = [
    "celebrations",
    "classic collection",
    "black star promo",
    "sv promo",
    "promo",
  ];

  for (const phrase of conflictPhrases) {
    if (normalizedTitle.includes(phrase) && !normalizeCardName(setName).toLowerCase().includes(phrase)) {
      score -= 5;
    }
  }

  return score;
}

function hasConflictingSetMarker(title: string, setName: string) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const normalizedSetName = normalizeCardName(setName).toLowerCase();
  const conflictPhrases = [
    "celebrations",
    "classic collection",
    "black star promo",
    "sv promo",
  ];

  return conflictPhrases.some(
    (phrase) => normalizedTitle.includes(phrase) && !normalizedSetName.includes(phrase),
  );
}

async function fetchHtml(url: string) {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: PUBLIC_FETCH_HEADERS,
        next: { revalidate: 43_200 },
        signal: AbortSignal.timeout(24_000),
      });

      if (!response.ok) {
        const retriable =
          response.status === 429 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (retriable && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }

        throw new Error(`Public page request failed: ${response.status}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Public page request failed");
}

function buildSoldCompQueries(setName: string, cardName: string, cardNumber: string) {
  const normalizedName = normalizeCardName(cardName);
  const normalizedSetName = normalizeCardName(setName);
  const numberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const queries = new Set<string>([
    `Pokemon ${normalizedName} ${cardNumber} ${normalizedSetName}`.trim(),
    `Pokemon ${normalizedName} ${numberBase} ${normalizedSetName}`.trim(),
  ]);

  if (/\bstar\b/i.test(normalizedName)) {
    const goldStarName = normalizedName.replace(/\bstar\b/i, "Gold Star");
    queries.add(`Pokemon ${goldStarName} ${cardNumber} ${normalizedSetName}`.trim());
  }

  return [...queries];
}

function parseTcgFishPopulation(html: string, url: string): PsaPopulationSnapshot {
  let totalCertified = null;
  const totalPopMatch = html.match(/Total population: \\",\\"([0-9,]+)\\",\\" copies/);

  if (totalPopMatch) {
    totalCertified = parseInt(totalPopMatch[1].replace(/,/g, ""), 10);
  } else {
    const totalPopFallback = html.match(/Total population: <!-- -->([0-9,]+)<!-- --> copies/);

    if (totalPopFallback) {
      totalCertified = parseInt(totalPopFallback[1].replace(/,/g, ""), 10);
    }
  }

  const grades: PsaPopulationSnapshot["grades"] = [];

  for (const grade of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
    const patterns = [
      new RegExp(
        `PSA(?:\\s|<!-- -->)*${grade}[\\s\\S]{0,220}?ecom-population-section-value[^>]*>([0-9,]+)<`,
        "i",
      ),
      new RegExp(
        `children":\\["PSA ","${grade}"\\][\\s\\S]{0,220}?children":"([0-9,]+)"`,
        "i",
      ),
    ];

    const match = patterns
      .map((pattern) => html.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));

    if (match?.[1]) {
      grades.push({
        grade: `PSA ${grade}`,
        count: parseInt(match[1].replace(/,/g, ""), 10),
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.66,
        evidenceType: "population",
        sourceUrl: url,
      });
      continue;
    }
  }

  return {
    status: grades.length || typeof totalCertified === "number" ? "verified" : "pending",
    totalCertified,
    grades,
    source: "TCGFish public population page",
    fetchedAt: new Date().toISOString(),
    sourceUrl: url,
    note: "PSA population is extracted from a public card population page and normalized into our own grade-by-grade model.",
    service: "PSA",
    confidence: grades.length ? "medium" : "low",
    confidenceScore: grades.length ? 0.66 : 0.35,
    evidenceType: "population",
  };
}

function parsePriceChartingPopulation(
  html: string,
  url: string,
): {
  population: PsaPopulationSnapshot;
  gradedPrices: Map<string, GradedPrice>;
} {
  const text = stripHtml(html);
  const grades: PsaPopulationSnapshot["grades"] = [];
  const gradedPrices = new Map<string, GradedPrice>();

  for (const grade of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
    const rowMatch = text.match(
      new RegExp(`(?:^|\\s)${grade}\\s+([0-9,]+)\\s+(?:-|[0-9,]+)\\s+([0-9,]+)\\s+\\$([0-9,.]+)`, "i"),
    );

    if (!rowMatch) {
      continue;
    }

    const count = parseInt(rowMatch[1].replace(/,/g, ""), 10);
    const value = parseUsd(rowMatch[3]);
    const gradeLabel = `PSA ${grade}`;

    grades.push({
      grade: gradeLabel,
      count,
      service: "PSA",
      confidence: "medium",
      confidenceScore: 0.62,
      evidenceType: "population",
      sourceUrl: url,
    });

    if (Number.isFinite(value) && value > 0) {
      gradedPrices.set(gradeLabel, {
        grade: gradeLabel,
        value,
        populationCount: count,
        source: "PriceCharting population snapshot",
        saleCount: 0,
        lastSoldAt: null,
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.56,
        evidenceType: "guide_snapshot",
        sourceUrl: url,
      });
    }
  }

  const totalMatch = text.match(/\bTotal\s+([0-9,]+)\s+(?:-|[0-9,]+)\s+([0-9,]+)/i);
  const totalCertified = totalMatch
    ? parseInt(totalMatch[1].replace(/,/g, ""), 10)
    : grades.reduce((sum, grade) => sum + grade.count, 0) || null;

  return {
    population: {
      status: grades.length || typeof totalCertified === "number" ? "verified" : "pending",
      totalCertified,
      grades,
      source: "PriceCharting public population report",
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      note: "PSA population was extracted from PriceCharting's public population table when the primary population page did not expose grade counts.",
      service: "PSA",
      confidence: grades.length ? "medium" : "low",
      confidenceScore: grades.length ? 0.62 : 0.35,
      evidenceType: "population",
    },
    gradedPrices,
  };
}

async function fetchPriceChartingPopulationWithVariants(
  setName: string,
  cardName: string,
  cardNumber: string,
): Promise<{
  population: PsaPopulationSnapshot;
  gradedPrices: Map<string, GradedPrice>;
} | null> {
  const setSlug = `pokemon-${priceChartingSlugify(setName)}`;
  const nameSlug = priceChartingSlugify(cardName);

  for (const numberSlug of numberSlugVariantsForExternalApis(cardNumber)) {
    const url = `https://www.pricecharting.com/pop/item/${setSlug}/${nameSlug}-${numberSlug}`;

    try {
      const html = await fetchHtml(url);
      const parsed = parsePriceChartingPopulation(html, url);

      if (
        parsed.population.totalCertified !== null ||
        parsed.population.grades.length ||
        parsed.gradedPrices.size
      ) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function loadBestTcgFishPage(
  setSlug: string,
  nameSlug: string,
  cardNumber: string,
): Promise<{ html: string; url: string } | null> {
  const variants = numberSlugVariantsForExternalApis(cardNumber);
  const urls = variants.map((variant) => buildTcgFishCardUrl(setSlug, nameSlug, variant));
  const results = await Promise.allSettled(urls.map((url) => fetchHtml(url)));
  let best: { html: string; url: string; score: number } | null = null;

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = results[index];

    if (outcome.status !== "fulfilled") {
      continue;
    }

    const html = outcome.value;

    if (isLikelyBotWallHtml(html)) {
      continue;
    }

    const previewPopulation = parseTcgFishPopulation(html, urls[index]);
    const previewSnapshots = parseTcgFishGradeSnapshots(html, previewPopulation);
    const score =
      previewPopulation.grades.length * 14 +
      (typeof previewPopulation.totalCertified === "number" ? 10 : 0) +
      previewSnapshots.size * 5 +
      (html.includes("ecom-population") ? 4 : 0);

    if (!best || score > best.score) {
      best = { html, url: urls[index], score };
    }
  }

  if (best && best.score > 0) {
    return { html: best.html, url: best.url };
  }

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = results[index];

    if (outcome.status === "fulfilled" && !isLikelyBotWallHtml(outcome.value)) {
      return { html: outcome.value, url: urls[index] };
    }
  }

  return null;
}

async function mergePriceChartingGuidesFromVariants(
  setName: string,
  cardName: string,
  cardNumber: string,
) {
  const variants = numberSlugVariantsForExternalApis(cardNumber);
  const urls = variants.map((variant) => buildPriceChartingGameUrl(setName, cardName, variant));
  const results = await Promise.allSettled(urls.map((url) => fetchHtml(url)));
  const merged = new Map<string, GradedPrice>();

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = results[index];

    if (outcome.status !== "fulfilled") {
      continue;
    }

    const guidePrices = parsePriceChartingGradedGuide(outcome.value);

    for (const [grade, price] of guidePrices.entries()) {
      if (!merged.has(grade)) {
        merged.set(grade, price);
      }
    }
  }

  return merged;
}

function priceNearLabel(text: string, labelRegex: string): number | null {
  const match = text.match(new RegExp(`${labelRegex}[\\s\\S]{0,140}?\\$([0-9,.]+)`, "i"));

  if (!match) {
    return null;
  }

  const value = parseUsd(match[1]);

  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePriceChartingGradedGuide(html: string): Map<string, GradedPrice> {
  const prices = new Map<string, GradedPrice>();
  const text = stripHtml(html);

  if (text.length < 200 || /just a moment/i.test(text)) {
    return prices;
  }

  const push = (grade: string, value: number | null) => {
    if (value == null || !Number.isFinite(value) || value <= 0 || prices.has(grade)) {
      return;
    }

    prices.set(grade, {
      grade,
      value,
      populationCount: 0,
      source: "PriceCharting graded guide snapshot",
      saleCount: 0,
      lastSoldAt: null,
      service: gradeService(grade),
      confidence: "medium",
      confidenceScore: 0.52,
      evidenceType: grade === "Ungraded" ? "catalog" : "guide_snapshot",
      warning: "Reference snapshot used because sold-comp depth may be limited.",
    });
  };

  push("Ungraded", priceNearLabel(text, "\\bUngraded\\b"));

  for (const gradeNum of WHOLE_GRADES) {
    push(`PSA ${gradeNum}`, priceNearLabel(text, `\\bPSA\\s*${gradeNum}\\b`));
  }

  push(
    "BGS 10 Black",
    priceNearLabel(text, "\\bBGS\\s*10[^$]{0,60}?(?:Black\\s*Label|Black)\\b") ??
      priceNearLabel(text, "\\bBeckett\\s*10[^$]{0,60}?(?:Black\\s*Label|Black)\\b"),
  );
  for (const grade of HALF_GRADES) {
    push(
      `BGS ${grade}`,
      priceNearLabel(
        text,
        `\\bBGS\\s*${grade.replace(".", "\\.?")}\\b(?!\\s*(?:Black|Black\\s*Label))`,
      ) ??
        priceNearLabel(
          text,
          `\\bBeckett\\s*${grade.replace(".", "\\.?")}\\b(?!\\s*(?:Black|Black\\s*Label))`,
        ),
    );
  }

  push(
    "CGC 10 Pristine",
    priceNearLabel(text, "\\bCGC\\s*10[^$]{0,50}?Pristine\\b") ??
      priceNearLabel(text, "\\bCGC\\s*Pristine\\b"),
  );
  for (const grade of HALF_GRADES) {
    push(
      `CGC ${grade}`,
      priceNearLabel(
        text,
        `\\bCGC\\s*${grade.replace(".", "\\.?")}\\b(?!\\s*Pristine)`,
      ),
    );
    push(`SGC ${grade}`, priceNearLabel(text, `\\bSGC\\s*${grade.replace(".", "\\.?")}\\b`));
  }

  for (const grade of WHOLE_GRADES) {
    push(`TAG ${grade}`, priceNearLabel(text, `\\bTAG\\s*${grade}\\b`));
  }

  return prices;
}

function parseTcgFishGradeSnapshots(
  html: string,
  population: PsaPopulationSnapshot,
): Map<string, GradedPrice> {
  const prices = new Map<string, GradedPrice>();
  const priceRegex =
    /class="grade-badge[^>]*>([^<]+)<\/div>.*?class="grade-price-info"><span>\$([0-9,.]+)<\/span><\/div>/g;

  for (const match of html.matchAll(priceRegex)) {
    const gradeLabel = normalizeWhitespace(match[1]);
    const value = parseUsd(match[2]);
    const populationCount =
      population.grades.find((grade) => grade.grade === gradeLabel)?.count ?? 0;

    prices.set(gradeLabel, {
      grade: gradeLabel,
      value,
      populationCount,
      source: "TCGFish market snapshot",
      saleCount: 0,
      lastSoldAt: null,
      service: gradeService(gradeLabel),
      confidence: "medium",
      confidenceScore: 0.58,
      evidenceType: gradeLabel === "Ungraded" ? "catalog" : "guide_snapshot",
      sourceUrl: population.sourceUrl,
      warning: "Market snapshot used as reference evidence.",
    });
  }

  return prices;
}

function parseMagerySales(
  html: string,
  cardName: string,
  cardNumber: string,
  setName: string,
): { accepted: SaleRecord[]; rejected: number } {
  const blockRegex =
    /data-item-id="(\d+)"[\s\S]*?<div class="card-title"[^>]*><a href="[^"]+">([\s\S]*?)<\/a><\/div>[\s\S]*?<span class="card-meta-date">[\s\S]*?<span>([^<]+)<\/span><\/span><span class="card-status status-sold">Sold<\/span>[\s\S]*?<div class="card-price sold">\$([^<]+)<\/div>[\s\S]*?<a href="([^"]+)"[\s\S]*?class="seller-link"[\s\S]*?>[\s\S]*?Seller:\s*([^<]+?)\s*<\/a>[\s\S]*?<a href="([^"]+)"[\s\S]*?>[\s\S]*?View Listing/gi;

  const sales: SaleRecord[] = [];
  let rejected = 0;

  for (const match of html.matchAll(blockRegex)) {
    const title = normalizeWhitespace(match[2]);

    if (hasBadSaleTitleSignals(title)) {
      rejected += 1;
      continue;
    }

    if (!isRelevantSaleTitle(title, cardName, cardNumber, setName)) {
      rejected += 1;
      continue;
    }

    if (hasConflictingSetMarker(title, setName)) {
      rejected += 1;
      continue;
    }

    const condition = detectSaleCondition(title);
    const relevanceScore = scoreSaleTitle(title, cardName, cardNumber, setName);
    const price = parseUsd(match[4]);

    if (relevanceScore < 10 || !Number.isFinite(price) || price <= 0) {
      rejected += 1;
      continue;
    }

    const listingUrl = toAbsoluteUrl(match[7]);
    sales.push({
      date: toIsoDate(normalizeWhitespace(match[3])),
      title,
      condition,
      price,
      source: "Magery public sold comps",
      seller: normalizeWhitespace(match[6]),
      listingUrl,
      sourceUrl: listingUrl,
      service: gradeService(condition),
      confidence: relevanceScore >= 18 ? "high" : relevanceScore >= 13 ? "medium" : "low",
      confidenceScore: Math.min(0.92, Math.max(0.42, relevanceScore / 24)),
      evidenceType: "sold_comp",
    });
  }

  return { accepted: sales, rejected };
}

async function fetchSoldComps(
  setName: string,
  cardName: string,
  cardNumber: string,
) {
  const dedupedSales = new Map<string, SaleRecord>();
  let rejected = 0;

  for (const query of buildSoldCompQueries(setName, cardName, cardNumber)) {
    const url = `https://magery.com/w?q=${encodeURIComponent(query)}`;
    const html = await fetchHtml(url);
    const parsedSales = parseMagerySales(html, cardName, cardNumber, setName);
    rejected += parsedSales.rejected;

    for (const sale of parsedSales.accepted) {
      dedupedSales.set(
        `${sale.date}-${sale.title}-${sale.price}-${sale.condition}`,
        sale,
      );
    }

    if (dedupedSales.size >= 64) {
      break;
    }
  }

  const accepted = [...dedupedSales.values()]
    .sort((left, right) => {
      const scoreDelta =
        scoreSaleTitle(right.title, cardName, cardNumber, setName) -
        scoreSaleTitle(left.title, cardName, cardNumber, setName);

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return right.date.localeCompare(left.date);
    })
    .slice(0, 56);

  return { accepted, rejected };
}

function buildPriceHistoryFromSales(salesByGrade: Map<string, SaleRecord[]>): PricePoint[] {
  const dateMap = new Map<string, Record<string, number>>();

  for (const [grade, sales] of salesByGrade.entries()) {
    const grouped = new Map<string, number[]>();

    for (const sale of sales) {
      const dateSales = grouped.get(sale.date) ?? [];
      dateSales.push(sale.price);
      grouped.set(sale.date, dateSales);
    }

    for (const [date, prices] of grouped.entries()) {
      const valuesForDate = dateMap.get(date) ?? {};
      valuesForDate[grade] = robustMedian(prices);
      dateMap.set(date, valuesForDate);
    }
  }

  return [...dateMap.entries()]
    .sort(([left], [right]) => chartTimelineSortKey(left) - chartTimelineSortKey(right))
    .map(([date, gradeValues]) => ({
      date,
      value: typeof gradeValues.Ungraded === "number" ? gradeValues.Ungraded : 0,
      gradeValues,
    }));
}

function filterOutlierSales(sales: SaleRecord[], snapshot?: GradedPrice) {
  if (sales.length <= 2) {
    if (!snapshot?.value || snapshot.value <= 0) {
      return sales;
    }

    return sales.filter((sale) => sale.price >= snapshot.value / 4 && sale.price <= snapshot.value * 4);
  }

  const baseline = robustMedian(sales.map((sale) => sale.price));
  return sales.filter((sale) => sale.price >= baseline / 3 && sale.price <= baseline * 3);
}

function isThinUncorroboratedGrade(sales: SaleRecord[], snapshot?: GradedPrice) {
  if (sales.length !== 1) {
    return false;
  }

  if (!snapshot?.value || snapshot.value <= 0) {
    return true;
  }

  const salePrice = sales[0].price;
  return salePrice < snapshot.value / 4 || salePrice > snapshot.value * 4;
}

function gradeSortKey(grade: string) {
  if (grade === "Ungraded") {
    return 9_000;
  }

  const serviceOrder: Record<string, number> = {
    PSA: 0,
    BGS: 1,
    BECKETT: 1,
    CGC: 2,
    SGC: 3,
    TAG: 4,
  };
  const service = grade.match(/^[A-Z]+/)?.[0] ?? "ZZZ";
  const gradeNumber = Number.parseFloat(grade.match(/\d+(?:\.\d+)?/)?.[0] ?? "0");
  const specialOffset = /BLACK|PRISTINE/i.test(grade) ? -0.25 : 0;

  return (serviceOrder[service] ?? 8) * 100 - gradeNumber + specialOffset;
}

function sortGradedPricesList(prices: GradedPrice[]) {
  return [...prices].sort((left, right) => {
    return gradeSortKey(left.grade) - gradeSortKey(right.grade);
  });
}

function hasPopulationSignal(snapshot: PsaPopulationSnapshot) {
  return snapshot.grades.length > 0 || typeof snapshot.totalCertified === "number";
}

export function shouldPreferIncomingPopulation(
  incoming: PsaPopulationSnapshot,
  current: PsaPopulationSnapshot,
) {
  if (hasPopulationSignal(incoming)) {
    return true;
  }

  if (!hasPopulationSignal(current)) {
    return true;
  }

  return false;
}

export function mergeCatalogAndLiveGradedPrices(
  catalog: GradedPrice[],
  live: GradedPrice[],
): GradedPrice[] {
  const liveSlab = live.filter((price) => price.grade !== "Ungraded");

  if (liveSlab.length > 0) {
    return sortGradedPricesList(live);
  }

  const liveUngraded = live.find((price) => price.grade === "Ungraded");
  const catalogSlab = catalog.filter((price) => price.grade !== "Ungraded");

  if (liveUngraded) {
    return sortGradedPricesList([liveUngraded, ...catalogSlab]);
  }

  return catalog.length ? sortGradedPricesList(catalog) : sortGradedPricesList(live);
}

export function mergeLiveMarketDataIntoCard(
  card: TcgCard,
  psaData: {
    psaPopulation: PsaPopulationSnapshot;
    gradedPrices: GradedPrice[];
    priceHistory?: PricePoint[];
    recentSales?: SaleRecord[];
    evidenceSummary?: TcgCard["evidenceSummary"];
  },
) {
  const catalogPriceHistory = [...card.priceHistory];
  const catalogGraded = [...card.gradedPrices];

  if (shouldPreferIncomingPopulation(psaData.psaPopulation, card.psaPopulation)) {
    card.psaPopulation = psaData.psaPopulation;
    card.gradingPopulation = psaData.psaPopulation;
  }

  card.gradedPrices = mergeCatalogAndLiveGradedPrices(catalogGraded, psaData.gradedPrices);

  if (!card.gradedPrices.some((price) => price.grade === "Ungraded")) {
    const catalogUngraded = catalogGraded.find((price) => price.grade === "Ungraded");
    if (catalogUngraded) {
      card.gradedPrices = sortGradedPricesList([catalogUngraded, ...card.gradedPrices]);
    }
  }

  if (psaData.priceHistory?.length) {
    card.priceHistory = mergePriceHistoryWithCatalog(catalogPriceHistory, psaData.priceHistory);
  }

  if (psaData.recentSales?.length) {
    card.recentSales = psaData.recentSales;
  }

  if (psaData.evidenceSummary) {
    card.evidenceSummary = psaData.evidenceSummary;
  }
}

function isExtendedGraderSnapshotLabel(grade: string) {
  return grade === "Ungraded" || /^(PSA|BGS|BECKETT|CGC|TAG|SGC)\b/i.test(grade);
}

export async function fetchLivePsaData(
  setName: string,
  cardName: string,
  cardNumber: string,
  rawMarketPriceUsd?: number,
): Promise<{
  psaPopulation: PsaPopulationSnapshot;
  population: PsaPopulationSnapshot;
  gradedPrices: GradedPrice[];
  priceHistory?: PricePoint[];
  recentSales?: SaleRecord[];
  evidenceSummary: NonNullable<TcgCard["evidenceSummary"]>;
} | null> {
  const marketUsd =
    typeof rawMarketPriceUsd === "number" && Number.isFinite(rawMarketPriceUsd)
      ? rawMarketPriceUsd
      : 0;
  const normalizedCardName = normalizeCardName(cardName);
  const normalizedSetName = normalizeCardName(setName);
  const setSlug = slugify(normalizedSetName);
  const nameSlug = slugify(normalizedCardName);
  const primaryNumberSlug = numberSlugVariantsForExternalApis(cardNumber)[0] ?? slugify(cardNumber);
  const primaryTcgUrl = buildTcgFishCardUrl(setSlug, nameSlug, primaryNumberSlug);

  const tcgLoaded = await loadBestTcgFishPage(setSlug, nameSlug, cardNumber);

  let psaPopulation: PsaPopulationSnapshot;
  const snapshotPrices = new Map<string, GradedPrice>();

  if (tcgLoaded) {
    psaPopulation = parseTcgFishPopulation(tcgLoaded.html, tcgLoaded.url);
    const fishSnapshots = parseTcgFishGradeSnapshots(tcgLoaded.html, psaPopulation);

    for (const [grade, price] of fishSnapshots.entries()) {
      snapshotPrices.set(grade, price);
    }
  } else {
    psaPopulation = pendingPsaPopulation(
      primaryTcgUrl,
      "TCGFish did not return a usable card page (network, blocking page, or unknown slug).",
    );
  }

  try {
    const guidePrices = await mergePriceChartingGuidesFromVariants(setName, cardName, cardNumber);

    for (const [grade, price] of guidePrices.entries()) {
      if (!snapshotPrices.has(grade)) {
        snapshotPrices.set(grade, price);
      }
    }
  } catch (_error) {
    // PriceCharting guide is optional; continue with whatever TCGFish already provided.
  }

  if (psaPopulation.totalCertified === null && !psaPopulation.grades.length) {
    try {
      const priceChartingPopulation = await fetchPriceChartingPopulationWithVariants(
        setName,
        cardName,
        cardNumber,
      );

      if (priceChartingPopulation) {
        psaPopulation = priceChartingPopulation.population;

        for (const [grade, price] of priceChartingPopulation.gradedPrices.entries()) {
          snapshotPrices.set(grade, price);
        }
      }
    } catch (_error) {
      // Population fallback is best-effort.
    }
  }

  let allSales: SaleRecord[] = [];
  let rejectedSales = 0;

  try {
    const soldCompResult = await fetchSoldComps(setName, cardName, cardNumber);
    allSales = soldCompResult.accepted;
    rejectedSales = soldCompResult.rejected;
  } catch (_error) {
    allSales = [];
    rejectedSales = 0;
  }

  const salesResults: { grade: string; sales: SaleRecord[] }[] = SOLD_COMP_GRADES.map((grade) => ({
    grade,
    sales: allSales.filter((sale) => sale.condition === grade),
  }));

  const salesByGrade = new Map<string, SaleRecord[]>(
    salesResults.map((result) => [result.grade, result.sales]),
  );

  const gradedPrices: GradedPrice[] = [];
  let thinEvidenceCount = 0;
  let fallbackEvidenceCount = 0;

  for (const grade of SOLD_COMP_GRADES) {
    const snapshot = snapshotPrices.get(grade);
    const sales = filterOutlierSales(salesByGrade.get(grade) ?? [], snapshot);
    salesByGrade.set(grade, sales);

    if (sales.length) {
      if (isThinUncorroboratedGrade(sales, snapshot)) {
        thinEvidenceCount += 1;
        gradedPrices.push({
          grade,
          value: sales[0].price,
          populationCount:
            psaPopulation.grades.find((populationGrade) => populationGrade.grade === grade)?.count ?? 0,
          source: "Single public sold comp (unconfirmed estimate)",
          saleCount: 1,
          lastSoldAt: sales[0].date,
          service: gradeService(grade),
          confidence: "low",
          confidenceScore: 0.38,
          evidenceType: "sold_comp",
          sourceUrl: sales[0].listingUrl,
          warning: "Only one uncorroborated sold comp was found; do not treat as a firm market price.",
        });
        continue;
      }

      const value = reconcileSoldPriceWithSnapshot(sales, snapshot);
      const confidence = soldCompConfidence(sales, snapshot);
      gradedPrices.push({
        grade,
        value,
        populationCount:
          psaPopulation.grades.find((populationGrade) => populationGrade.grade === grade)?.count ?? 0,
        source:
          sales.length >= 6
            ? "Engineered from public sold comps"
            : "Blended sold comps + market snapshot (thin sample)",
        saleCount: sales.length,
        lastSoldAt: sales[0]?.date ?? null,
        service: gradeService(grade),
        confidence: confidence.confidence,
        confidenceScore: confidence.confidenceScore,
        evidenceType: "sold_comp",
        sourceUrl: sales[0]?.listingUrl,
        warning:
          confidence.confidence === "low"
            ? "Thin sold-comp sample; reference as an estimate."
            : undefined,
      });
      continue;
    }

    if (snapshot) {
      fallbackEvidenceCount += 1;
      const confidence = guideConfidence(snapshot.source);
      gradedPrices.push({
        ...snapshot,
        service: snapshot.service ?? gradeService(snapshot.grade),
        confidence: snapshot.confidence ?? confidence.confidence,
        confidenceScore: snapshot.confidenceScore ?? confidence.confidenceScore,
        evidenceType: snapshot.evidenceType ?? "guide_snapshot",
        warning: snapshot.warning ?? "No accepted sold comps for this grade; using public reference snapshot.",
      });
    }
  }

  const includedSnapshotGrades = new Set(gradedPrices.map((price) => price.grade));

  for (const price of snapshotPrices.values()) {
    if (
      !includedSnapshotGrades.has(price.grade) &&
      isExtendedGraderSnapshotLabel(price.grade)
    ) {
      gradedPrices.push(price);
      fallbackEvidenceCount += 1;
      includedSnapshotGrades.add(price.grade);
    }
  }

  if (
    marketUsd > 0 &&
    !gradedPrices.some((price) => price.grade === "Ungraded")
  ) {
    gradedPrices.unshift({
      grade: "Ungraded",
      value: marketUsd,
      populationCount: 0,
      source: "PokemonTCG live market fallback",
      saleCount: 0,
      lastSoldAt: null,
      service: "RAW",
      confidence: "medium",
      confidenceScore: 0.55,
      evidenceType: "catalog",
      warning: "Catalog market price used because accepted public sold comps were unavailable.",
    });
    fallbackEvidenceCount += 1;
  }

  const recentSales = [...salesByGrade.values()]
    .flat()
    .sort((left, right) => right.date.localeCompare(left.date))
    .filter((sale, index, sales) => {
      return (
        sales.findIndex(
          (candidate) =>
            candidate.date === sale.date &&
            candidate.title === sale.title &&
            candidate.price === sale.price,
        ) === index
      );
    })
    .slice(0, 36);

  const chartableSalesByGrade = new Map(
    [...salesByGrade.entries()]
      .filter(([grade, sales]) => grade === "Ungraded" ? sales.length >= 2 : sales.length >= 2)
      .map(([grade, sales]) => [grade, sales] as const),
  );
  const priceHistory = buildPriceHistoryFromSales(chartableSalesByGrade);

  if (
    !hasPopulationSignal(psaPopulation) &&
    !gradedPrices.length &&
    !recentSales.length &&
    !(marketUsd > 0)
  ) {
    return null;
  }

  return {
    psaPopulation,
    population: psaPopulation,
    gradedPrices,
    priceHistory,
    recentSales,
    evidenceSummary: {
      accepted: allSales.length,
      rejected: rejectedSales,
      thin: thinEvidenceCount,
      fallback: fallbackEvidenceCount,
    },
  };
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

  return "Population unavailable";
}
