/**
 * TCGdex Japanese cards often share English-set ids (`neo3-001`). That id is
 * the English parallel print (Ampharos), not the Japanese card (Zubat). Never
 * trust a same-id English companion name unless the localized name agrees.
 */

function normalizeNameText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLatinCardName(name: string) {
  const trimmed = name.trim();

  if (!trimmed || trimmed.length < 3) {
    return false;
  }

  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(trimmed)) {
    return false;
  }

  return /[A-Za-z]{3,}/.test(trimmed) && /^[A-Za-z0-9][A-Za-z0-9 .'\-&éÉ#]*$/.test(trimmed);
}

export function tcgdexEnglishCompanionNameAgrees(
  localizedName?: string | null,
  companionName?: string | null,
) {
  const loc = localizedName?.trim() ?? "";
  const comp = companionName?.trim() ?? "";

  if (!loc || !comp) {
    return false;
  }

  const locCore = loc.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const locNorm = normalizeNameText(locCore);
  const compNorm = normalizeNameText(comp);

  if (!locNorm || !compNorm) {
    return false;
  }

  if (locNorm === compNorm) {
    return true;
  }

  // A Latin localized name that already disagrees (Zubat vs Ampharos) is a
  // same-id companion miss. Non-Latin names cannot be verified here.
  return false;
}

export function inferEnglishNameFromTcgdexLocalizedName(localizedName?: string | null) {
  const trimmed = localizedName?.trim() ?? "";

  if (!trimmed) {
    return undefined;
  }

  const bilingual = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);

  if (bilingual) {
    const leading = bilingual[1].trim();
    const inner = bilingual[2].trim();

    if (
      isLatinCardName(leading) &&
      isLatinCardName(inner) &&
      !tcgdexEnglishCompanionNameAgrees(leading, inner)
    ) {
      return leading;
    }

    if (isLatinCardName(leading)) {
      return leading;
    }

    // A Japanese leading name plus an English parenthetical is often the
    // same-id companion (キャタピー (Espeon)). Do not trust the inner name.
  }

  return isLatinCardName(trimmed) ? trimmed : undefined;
}

export function resolveJapaneseListEnglishName(query: {
  name?: string | null;
  englishName?: string | null;
  localizedName?: string | null;
}) {
  const inferred = inferEnglishNameFromTcgdexLocalizedName(
    query.localizedName || query.name || "",
  );
  const companion = query.englishName?.trim() || undefined;

  if (inferred && companion && !tcgdexEnglishCompanionNameAgrees(inferred, companion)) {
    return inferred;
  }

  if (inferred) {
    return inferred;
  }

  const localized = (query.localizedName || query.name || "")
    .replace(/\s*\([^)]+\)\s*$/, "")
    .trim();

  if (localized && !isLatinCardName(localized)) {
    return undefined;
  }

  return companion;
}
