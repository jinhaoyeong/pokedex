/**
 * Shared Japanese / localized set metadata for catalog labels, sold-comp matching,
 * and PriceCharting slug resolution. English and Japanese releases often share a
 * Pokemon TCG API set id (e.g. sm12) but use different expansion names and card numbers.
 */

export type LocalizedSetMarketProfile = {
  englishName: string;
  priceChartingSlug?: string;
  aliases?: string[];
};

/** Set code (uppercase) → market profile for non-English prints. */
export const LOCALIZED_SET_MARKET_PROFILES: Record<string, LocalizedSetMarketProfile> = {
  // Sun & Moon — Japanese expansion names (shared sm* ids with English)
  SM1S: { englishName: "Collection Sun", priceChartingSlug: "pokemon-japanese-collection-sun" },
  SM1M: { englishName: "Collection Moon", priceChartingSlug: "pokemon-japanese-collection-moon" },
  SM2K: { englishName: "Islands Await You", priceChartingSlug: "pokemon-japanese-islands-await-you" },
  SM2L: { englishName: "Alolan Moonlight", priceChartingSlug: "pokemon-japanese-alolan-moonlight" },
  SM2P: { englishName: "Facing a New Trial", priceChartingSlug: "pokemon-japanese-facing-a-new-trial" },
  SM3H: { englishName: "To Have Seen the Battle Rainbow", priceChartingSlug: "pokemon-japanese-to-have-seen-the-battle-rainbow" },
  SM3N: { englishName: "Darkness that Consumes Light", priceChartingSlug: "pokemon-japanese-darkness-that-consumes-light" },
  SM3P: { englishName: "Shining Legends", priceChartingSlug: "pokemon-japanese-shining-legends" },
  SM4S: { englishName: "Awakened Heroes", priceChartingSlug: "pokemon-japanese-awakened-heroes" },
  SM4A: { englishName: "Ultradimensional Beasts", priceChartingSlug: "pokemon-japanese-ultradimensional-beasts" },
  SM5S: { englishName: "Ultra Sun", priceChartingSlug: "pokemon-japanese-ultra-sun" },
  SM5M: { englishName: "Ultra Moon", priceChartingSlug: "pokemon-japanese-ultra-moon" },
  SM5P: { englishName: "Ultra Force", priceChartingSlug: "pokemon-japanese-ultra-force" },
  SM6: { englishName: "Forbidden Light", priceChartingSlug: "pokemon-japanese-forbidden-light" },
  SM6A: { englishName: "Dragon Storm", priceChartingSlug: "pokemon-japanese-dragon-storm" },
  SM7: { englishName: "Sky-Splitting Charisma", priceChartingSlug: "pokemon-japanese-sky-splitting-charisma" },
  SM7A: { englishName: "Thunderclap Spark", priceChartingSlug: "pokemon-japanese-thunderclap-spark" },
  SM8: { englishName: "Super-Burst Impact", priceChartingSlug: "pokemon-japanese-super-burst-impact" },
  SM8A: { englishName: "Dark Order", priceChartingSlug: "pokemon-japanese-dark-order" },
  SM9: { englishName: "Tag Bolt", priceChartingSlug: "pokemon-japanese-tag-bolt" },
  SM9A: { englishName: "Night Unison", priceChartingSlug: "pokemon-japanese-night-unison" },
  SM10: { englishName: "Double Blaze", priceChartingSlug: "pokemon-japanese-double-blaze" },
  SM10A: { englishName: "GG End", priceChartingSlug: "pokemon-japanese-gg-end" },
  SM11: { englishName: "Miracle Twin", priceChartingSlug: "pokemon-japanese-miracle-twin" },
  SM11A: { englishName: "Remix Bout", priceChartingSlug: "pokemon-japanese-remix-bout" },
  SM12: { englishName: "Alter Genesis", priceChartingSlug: "pokemon-japanese-alter-genesis", aliases: ["SM12 Alter Genesis"] },
  SM12A: { englishName: "Dream League", priceChartingSlug: "pokemon-japanese-dream-league" },
  // Sword & Shield — Japanese S* codes
  S1W: { englishName: "Sword", priceChartingSlug: "pokemon-japanese-sword" },
  S1H: { englishName: "Shield", priceChartingSlug: "pokemon-japanese-shield" },
  S2: { englishName: "Rebellion Crash", priceChartingSlug: "pokemon-japanese-rebellion-crash" },
  S3: { englishName: "Infinity Zone", priceChartingSlug: "pokemon-japanese-infinity-zone" },
  S4: { englishName: "Amazing Volt Tackle", priceChartingSlug: "pokemon-japanese-amazing-volt-tackle" },
  S5I: { englishName: "Single Strike Master", priceChartingSlug: "pokemon-japanese-single-strike-master" },
  S5R: { englishName: "Rapid Strike Master", priceChartingSlug: "pokemon-japanese-rapid-strike-master" },
  S6H: { englishName: "Silver Lance", priceChartingSlug: "pokemon-japanese-silver-lance" },
  S6K: { englishName: "Jet-Black Spirit", priceChartingSlug: "pokemon-japanese-jet-black-spirit" },
  S7D: { englishName: "Skyscraping Perfection", priceChartingSlug: "pokemon-japanese-skyscraping-perfection" },
  S7R: { englishName: "Blue Sky Stream", priceChartingSlug: "pokemon-japanese-blue-sky-stream" },
  S8: { englishName: "Fusion Arts", priceChartingSlug: "pokemon-japanese-fusion-arts" },
  S8A: { englishName: "25th Anniversary Collection", priceChartingSlug: "pokemon-japanese-25th-anniversary-collection" },
  S9: { englishName: "Star Birth", priceChartingSlug: "pokemon-japanese-star-birth" },
  S10D: { englishName: "Time Gazer", priceChartingSlug: "pokemon-japanese-time-gazer" },
  S10P: { englishName: "Space Juggler", priceChartingSlug: "pokemon-japanese-space-juggler" },
  S11: { englishName: "Lost Abyss", priceChartingSlug: "pokemon-japanese-lost-abyss" },
  S12: { englishName: "Paradigm Trigger", priceChartingSlug: "pokemon-japanese-paradigm-trigger" },
  S12A: { englishName: "VSTAR Universe", priceChartingSlug: "pokemon-japanese-vstar-universe" },
  // Scarlet & Violet — already partially covered; extend common JP codes
  SV1S: { englishName: "Scarlet ex", priceChartingSlug: "pokemon-japanese-scarlet-ex" },
  SV1V: { englishName: "Violet ex", priceChartingSlug: "pokemon-japanese-violet-ex" },
  SV2D: { englishName: "Clay Burst", priceChartingSlug: "pokemon-japanese-clay-burst" },
  SV2P: { englishName: "Snow Hazard", priceChartingSlug: "pokemon-japanese-snow-hazard" },
  SV3: { englishName: "Ruler of the Black Flame", priceChartingSlug: "pokemon-japanese-ruler-of-the-black-flame" },
  SV3A: { englishName: "Raging Surf", priceChartingSlug: "pokemon-japanese-raging-surf" },
  SV4K: { englishName: "Ancient Roar", priceChartingSlug: "pokemon-japanese-ancient-roar" },
  SV4M: { englishName: "Future Flash", priceChartingSlug: "pokemon-japanese-future-flash" },
  SV5K: { englishName: "Wild Force", priceChartingSlug: "pokemon-japanese-wild-force" },
  SV5M: { englishName: "Cyber Judge", priceChartingSlug: "pokemon-japanese-cyber-judge" },
  SV5A: { englishName: "Crimson Haze", priceChartingSlug: "pokemon-japanese-crimson-haze" },
  SV6: { englishName: "Mask of Change", priceChartingSlug: "pokemon-japanese-mask-of-change" },
  SV6A: { englishName: "Night Wanderer", priceChartingSlug: "pokemon-japanese-night-wanderer" },
  SV7: { englishName: "Stellar Miracle", priceChartingSlug: "pokemon-japanese-stellar-miracle" },
  SV7A: { englishName: "Paradise Dragona", priceChartingSlug: "pokemon-japanese-paradise-dragona" },
  SV8: { englishName: "Super Electric Breaker", priceChartingSlug: "pokemon-japanese-super-electric-breaker" },
  SV8A: { englishName: "Terastal Festival ex", priceChartingSlug: "pokemon-japanese-terastal-festival-ex" },
  SV9: { englishName: "Battle Partners", priceChartingSlug: "pokemon-japanese-battle-partners" },
  SV9A: { englishName: "Heat Wave Arena", priceChartingSlug: "pokemon-japanese-heat-wave-arena" },
  SV10: { englishName: "The Glory of Team Rocket", priceChartingSlug: "pokemon-japanese-the-glory-of-team-rocket" },
  SV11W: { englishName: "White Flare", priceChartingSlug: "pokemon-japanese-white-flare" },
  SV11B: { englishName: "Black Bolt", priceChartingSlug: "pokemon-japanese-black-bolt" },
  // Classic / promo Japanese
  PMCG1: { englishName: "Expansion Pack" },
  PMCG2: { englishName: "Pokemon Jungle" },
  PMCG3: { englishName: "Mystery of the Fossils" },
  PMCG4: { englishName: "Rocket Gang" },
  PMCG5: { englishName: "Leaders' Stadium" },
  PMCG6: { englishName: "Challenge from the Darkness" },
  CP2: { englishName: "Legendary Shine Collection", priceChartingSlug: "pokemon-japanese-legendary-shine-collection" },
  CSM1C: { englishName: "Gem Pack Vol. 1", priceChartingSlug: "pokemon-chinese-gem-pack" },
  CSM2C: { englishName: "Gem Pack Vol. 2", priceChartingSlug: "pokemon-chinese-gem-pack-2" },
  CBB2C: { englishName: "Gem Pack Vol. 2", priceChartingSlug: "pokemon-chinese-gem-pack-2" },
  CSM1A: { englishName: "Brave Stars" },
  CSM1B: { englishName: "Fearless Terastal" },
  SV2A: { englishName: "Pokemon Card 151", priceChartingSlug: "pokemon-japanese-pokemon-card-151" },
  SV4A: { englishName: "Shiny Treasure ex", priceChartingSlug: "pokemon-japanese-shiny-treasure-ex" },
  SV8M: { englishName: "Super Electric Breaker", priceChartingSlug: "pokemon-japanese-super-electric-breaker" },
  SV8PT5: { englishName: "Prismatic Evolutions", priceChartingSlug: "pokemon-prismatic-evolutions" },
  S4A: { englishName: "Shining Star V", priceChartingSlug: "pokemon-japanese-shining-star-v" },
  S6A: { englishName: "Eevee Heroes", priceChartingSlug: "pokemon-japanese-eevee-heroes" },
  S8B: { englishName: "VMAX Climax", priceChartingSlug: "pokemon-japanese-vmax-climax" },
  S9A: { englishName: "Battle Region", priceChartingSlug: "pokemon-japanese-battle-region" },
  S10B: { englishName: "Pokemon GO", priceChartingSlug: "pokemon-japanese-pokemon-go" },
  S11A: { englishName: "Incandescent Arcana", priceChartingSlug: "pokemon-japanese-incandescent-arcana" },
  PROMO: { englishName: "Japanese Promo", priceChartingSlug: "pokemon-japanese-promo" },
};

const runtimeDiscoveredProfiles: Record<string, LocalizedSetMarketProfile> = {};

const IMPORT_MARKET_LABELS: Record<string, string> = {
  ja: "Japanese",
  ko: "Korean",
  "zh-tw": "Chinese",
  "zh-cn": "Chinese",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  "pt-br": "Portuguese",
  "pt-pt": "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  id: "Indonesian",
  th: "Thai",
};

function slugifyForMarket(text: string) {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function registerDiscoveredSetProfile(
  setCode: string,
  profile: LocalizedSetMarketProfile,
) {
  runtimeDiscoveredProfiles[setCode.trim().toUpperCase()] = profile;
}

export function getCachedDiscoveredPriceChartingSlug(setCode: string) {
  const profile = getLocalizedSetMarketProfile(setCode);
  return profile?.priceChartingSlug;
}

export function getLocalizedSetMarketProfile(setCodeOrId: string): LocalizedSetMarketProfile | undefined {
  const key = setCodeOrId.trim().toUpperCase();
  return LOCALIZED_SET_MARKET_PROFILES[key] ?? runtimeDiscoveredProfiles[key];
}

export function resolveLocalizedSetEnglishName(
  setIdOrCode: string,
  apiEnglishName?: string | null,
): string | undefined {
  const cleanApiName = apiEnglishName?.trim();
  if (cleanApiName) {
    return cleanApiName;
  }

  return getLocalizedSetMarketProfile(setIdOrCode)?.englishName;
}

export function getSetMarketAliases(
  setName: string,
  options: { setCode?: string; language?: string } = {},
): string[] {
  const aliases = new Set<string>();
  const trimmedName = setName.trim();
  const setCode = options.setCode?.trim().toUpperCase() ?? "";
  const profile = setCode ? getLocalizedSetMarketProfile(setCode) : undefined;

  if (trimmedName) {
    aliases.add(trimmedName);
  }

  if (setCode) {
    aliases.add(setCode);
    aliases.add(setCode.toLowerCase());
  }

  if (profile?.englishName) {
    aliases.add(profile.englishName);
  }

  for (const alias of profile?.aliases ?? []) {
    aliases.add(alias);
  }

  const importLabel = options.language ? IMPORT_MARKET_LABELS[options.language] : undefined;
  if (importLabel) {
    aliases.add(importLabel);
    if (profile?.englishName) {
      aliases.add(`${importLabel} ${profile.englishName}`);
    }
    if (setCode && profile?.englishName) {
      aliases.add(`${importLabel} ${setCode}`);
      aliases.add(`${importLabel} ${setCode} ${profile.englishName}`);
    }
  }

  return [...aliases].filter(Boolean);
}

export function getPriceChartingSetSlugVariants(
  setName: string,
  options: { setCode?: string; language?: string } = {},
): string[] {
  const setCode = options.setCode?.trim().toUpperCase() ?? "";
  const profile = setCode ? getLocalizedSetMarketProfile(setCode) : undefined;
  const candidates: string[] = [];

  if (profile?.priceChartingSlug) {
    candidates.push(profile.priceChartingSlug);
  }

  const englishName = profile?.englishName ?? resolveLocalizedSetEnglishName(setName);
  if (englishName && (options.language === "ja" || options.language === "ko" || options.language?.startsWith("zh"))) {
    candidates.push(`pokemon-japanese-${slugifyForMarket(englishName)}`);
    if (options.language === "ko") {
      candidates.push(`pokemon-korean-${slugifyForMarket(englishName)}`);
    }
  }

  const normalized = setName.trim();
  const withoutPokemonPrefix = normalized.replace(/^pokemon\s+/i, "");
  const rawSlug = slugifyForMarket(normalized);
  const setOnlySlug = slugifyForMarket(withoutPokemonPrefix);

  candidates.push(
    rawSlug.startsWith("pokemon-") ? rawSlug : `pokemon-${rawSlug}`,
    setOnlySlug ? `pokemon-${setOnlySlug}` : "",
    rawSlug,
  );

  if (setCode) {
    candidates.push(`pokemon-${setCode.toLowerCase()}`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

/** Pokemon TCG API set ids where JP and EN share an id but card numbers differ. */
export const SHARED_POKEMON_TCG_SET_IDS = new Set(
  [
    "sm1", "sm2", "sm3", "sm4", "sm5", "sm6", "sm7", "sm8", "sm9", "sm10", "sm11", "sm12",
    "swsh1", "swsh2", "swsh3", "swsh4", "swsh5", "swsh6", "swsh7", "swsh8", "swsh9", "swsh10", "swsh11", "swsh12",
    "sv1", "sv2", "sv3", "sv4", "sv5", "sv6", "sv7", "sv8", "sv9", "sv10",
  ].map((id) => id.toLowerCase()),
);

export function shouldUseEnglishCompanionMarketPrice(
  language: string,
  setId: string,
  localizedMarketPriceUsd: number,
): boolean {
  if (language === "en" || localizedMarketPriceUsd > 0) {
    return false;
  }

  return !SHARED_POKEMON_TCG_SET_IDS.has(setId.trim().toLowerCase());
}

export function isSuspiciouslyLowCatalogPrice(card: {
  marketPriceUsd: number;
  rarity?: string;
  setName?: string;
}): boolean {
  const price = card.marketPriceUsd;

  if (!(price > 0)) {
    return false;
  }

  const rarity = (card.rarity ?? "").toLowerCase();
  const setName = (card.setName ?? "").toLowerCase();

  if (
    /star|secret rare|special illustration|illustration rare|hyper rare|rainbow|gold star/i.test(
      rarity,
    ) &&
    price < 250
  ) {
    return true;
  }

  if (/pop series|neo |ex delta|ex dragon|ex unseen/i.test(setName) && price < 120) {
    return true;
  }

  if (/rare holo/i.test(rarity) && /pop |neo |ex /i.test(setName) && price < 80) {
    return true;
  }

  return false;
}

export function isTrustedCatalogMarketPrice(card: {
  marketPriceUsd: number;
  priceConsensus?: { sources?: Array<{ source?: string; evidenceType?: string }> };
  sources?: Array<{ source?: string }>;
}): boolean {
  if (!(card.marketPriceUsd >= 1)) {
    return false;
  }

  const consensusSources = card.priceConsensus?.sources ?? [];
  if (
    consensusSources.some(
      (source) =>
        source.evidenceType === "sold_comp" ||
        /public sold|magery/i.test(source.source ?? ""),
    )
  ) {
    return true;
  }

  return (card.sources ?? []).some((source) => /public sold|magery/i.test(source.source ?? ""));
}

export function shouldPreserveCatalogMarketPrice(
  catalogPriceUsd: number,
  incomingPriceUsd: number,
  options: {
    soldCompCount?: number;
    catalogTrusted?: boolean;
  } = {},
): boolean {
  if (!(catalogPriceUsd >= 1) || !options.catalogTrusted) {
    return false;
  }

  if ((options.soldCompCount ?? 0) >= 4) {
    return false;
  }

  // Only block downward moves from thin guide snapshots — never reject a higher
  // enrichment price when the catalog baseline was a bad strict-match or rarity floor.
  return incomingPriceUsd < catalogPriceUsd * 0.55;
}

export function getHeadlineMarketPriceUsd(card: {
  marketPriceUsd: number;
  gradedPrices?: Array<{ grade: string; value: number; confidenceScore?: number }>;
  priceConsensus?: { finalEstimateUsd: number; confidenceScore?: number };
}): number {
  const market = card.marketPriceUsd > 0 ? card.marketPriceUsd : 0;
  const ungraded = card.gradedPrices?.find((price) => price.grade === "Ungraded");
  const consensus = card.priceConsensus?.finalEstimateUsd ?? 0;
  const enriched = Math.max(ungraded?.value ?? 0, consensus);

  if (enriched > market * 1.15) {
    return enriched;
  }

  return market > 0 ? market : enriched;
}
