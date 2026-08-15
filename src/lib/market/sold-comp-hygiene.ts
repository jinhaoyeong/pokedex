/**
 * Shared sold-comp title hygiene for Magery and PriceCharting completed sales.
 * Presence of identity tokens is not enough: signed slabs, metal promos, and
 * damaged cards poison medians even when the name/number match.
 */

export type SoldCompJunkReason =
  | "bundle_proxy_reprint"
  | "signed_autograph"
  | "metal_jumbo_promo"
  | "damaged_slab";

export type SoldCompJunkOptions = {
  cardName?: string;
  rarity?: string;
};

function scrubCelebrationsClassicCollection(title: string) {
  // "Classic Collection" / "Classic Coll." is the Celebrations subset name —
  // not a multi-card lot. Scrub it before the lot filter so `\bcollection\b`
  // does not wipe every Celebrations Classic Collection comp.
  return title
    .replace(/\bclassic\s+coll(?:ection|\.)?\b/gi, " ")
    .replace(/\bcelebrations\s*:\s*classic\s+collection\b/gi, " ");
}

function cardIsMetalOrJumbo(options?: SoldCompJunkOptions) {
  return /\b(metal|jumbo|oversize)\b/i.test(`${options?.cardName ?? ""} ${options?.rarity ?? ""}`);
}

export function classifySoldCompJunk(
  title: string,
  options?: SoldCompJunkOptions,
): SoldCompJunkReason | null {
  const scrubbed = scrubCelebrationsClassicCollection(title);

  if (
    /\b(signed|autograph(?:ed)?|signature)\b/i.test(scrubbed) ||
    /\bauto\b/i.test(scrubbed) ||
    /\blogan\s+paul\b/i.test(scrubbed)
  ) {
    return "signed_autograph";
  }

  if (
    !cardIsMetalOrJumbo(options) &&
    (/\b(gold\s+metal|metal\s+card|metal\s+promo|jumbo|oversize|upc\s+promo)\b/i.test(scrubbed) ||
      (/\bmetal\b/i.test(scrubbed) && /\b(promo|upc|celebrations|gold)\b/i.test(scrubbed)))
  ) {
    return "metal_jumbo_promo";
  }

  if (
    /\b(slight\s+crack|cracked?|damaged\s+slab|for\s+parts|crack\s+on)\b/i.test(scrubbed)
  ) {
    return "damaged_slab";
  }

  if (
    /\b(lot|bundle|collection|pack|packs|box|booster|case|set of|mystery|proxy|reprint|custom|digital|code card|altered)\b/i.test(
      scrubbed,
    )
  ) {
    return "bundle_proxy_reprint";
  }

  return null;
}

export function soldCompJunkRejectLabel(reason: SoldCompJunkReason) {
  if (reason === "signed_autograph") {
    return "signed/autograph listing";
  }
  if (reason === "metal_jumbo_promo") {
    return "metal/jumbo/promo variant";
  }
  if (reason === "damaged_slab") {
    return "damaged/cracked slab";
  }
  return "bundle/proxy/reprint/altered signal";
}
