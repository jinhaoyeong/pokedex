/**
 * Shared Japanese / localized set metadata for catalog labels, sold-comp matching,
 * and PriceCharting slug resolution. English and Japanese releases often share a
 * Pokemon TCG API set id (e.g. sm12) but use different expansion names and card numbers.
 */

export type LocalizedSetMarketProfile = {
  englishName: string;
  priceChartingSlug?: string;
  /**
   * Extra PriceCharting set slugs for the same release. Promo cards often use a
   * different slug on /pop/item/ than on /game/ (e.g. pokemon-promo vs pokemon-xy-promo).
   */
  priceChartingSlugAliases?: string[];
  /** PriceCharting slug for the English international release that shares this card pool. */
  englishParallelPriceChartingSlug?: string;
  /** Alternate PriceCharting slugs for the English parallel (e.g. pokemon-151 vs scarlet-&-violet-151). */
  englishParallelPriceChartingSlugAliases?: string[];
  /** Display name for the English parallel release (PSA census is usually filed under this set). */
  englishParallelSetName?: string;
  aliases?: string[];
};

/**
 * Japanese / localized set code → English international release used for PSA population lookup.
 * Import prints often have near-zero PSA counts on their JP PriceCharting item; census data
 * lives on the matching English parallel card.
 */
const ENGLISH_PARALLEL_SET_LOOKUP: Record<
  string,
  Pick<
    LocalizedSetMarketProfile,
    | "englishParallelPriceChartingSlug"
    | "englishParallelPriceChartingSlugAliases"
    | "englishParallelSetName"
  >
> = {
  // Sun & Moon
  SM1S: { englishParallelPriceChartingSlug: "pokemon-sun-moon", englishParallelSetName: "Sun & Moon" },
  SM1M: { englishParallelPriceChartingSlug: "pokemon-sun-moon", englishParallelSetName: "Sun & Moon" },
  SM2K: { englishParallelPriceChartingSlug: "pokemon-guardians-rising", englishParallelSetName: "Guardians Rising" },
  SM2L: { englishParallelPriceChartingSlug: "pokemon-guardians-rising", englishParallelSetName: "Guardians Rising" },
  SM2P: { englishParallelPriceChartingSlug: "pokemon-burning-shadows", englishParallelSetName: "Burning Shadows" },
  SM3H: { englishParallelPriceChartingSlug: "pokemon-burning-shadows", englishParallelSetName: "Burning Shadows" },
  SM3N: { englishParallelPriceChartingSlug: "pokemon-crimson-invasion", englishParallelSetName: "Crimson Invasion" },
  SM3P: { englishParallelPriceChartingSlug: "pokemon-shining-legends", englishParallelSetName: "Shining Legends" },
  SM4S: { englishParallelPriceChartingSlug: "pokemon-ultra-prism", englishParallelSetName: "Ultra Prism" },
  SM4A: { englishParallelPriceChartingSlug: "pokemon-ultra-prism", englishParallelSetName: "Ultra Prism" },
  SM5S: { englishParallelPriceChartingSlug: "pokemon-forbidden-light", englishParallelSetName: "Forbidden Light" },
  SM5M: { englishParallelPriceChartingSlug: "pokemon-forbidden-light", englishParallelSetName: "Forbidden Light" },
  SM5P: { englishParallelPriceChartingSlug: "pokemon-forbidden-light", englishParallelSetName: "Forbidden Light" },
  SM6: { englishParallelPriceChartingSlug: "pokemon-forbidden-light", englishParallelSetName: "Forbidden Light" },
  SM6A: { englishParallelPriceChartingSlug: "pokemon-forbidden-light", englishParallelSetName: "Forbidden Light" },
  SM7: { englishParallelPriceChartingSlug: "pokemon-celestial-storm", englishParallelSetName: "Celestial Storm" },
  SM7A: { englishParallelPriceChartingSlug: "pokemon-celestial-storm", englishParallelSetName: "Celestial Storm" },
  SM8: { englishParallelPriceChartingSlug: "pokemon-lost-thunder", englishParallelSetName: "Lost Thunder" },
  SM8A: { englishParallelPriceChartingSlug: "pokemon-lost-thunder", englishParallelSetName: "Lost Thunder" },
  SM9: { englishParallelPriceChartingSlug: "pokemon-team-up", englishParallelSetName: "Team Up" },
  SM9A: { englishParallelPriceChartingSlug: "pokemon-team-up", englishParallelSetName: "Team Up" },
  SM10: { englishParallelPriceChartingSlug: "pokemon-unbroken-bonds", englishParallelSetName: "Unbroken Bonds" },
  SM10A: { englishParallelPriceChartingSlug: "pokemon-unbroken-bonds", englishParallelSetName: "Unbroken Bonds" },
  SM11: { englishParallelPriceChartingSlug: "pokemon-unified-minds", englishParallelSetName: "Unified Minds" },
  SM11A: { englishParallelPriceChartingSlug: "pokemon-unified-minds", englishParallelSetName: "Unified Minds" },
  SM11B: { englishParallelPriceChartingSlug: "pokemon-unified-minds", englishParallelSetName: "Unified Minds" },
  SM12: { englishParallelPriceChartingSlug: "pokemon-cosmic-eclipse", englishParallelSetName: "Cosmic Eclipse" },
  SM12A: { englishParallelPriceChartingSlug: "pokemon-cosmic-eclipse", englishParallelSetName: "Cosmic Eclipse" },
  // Sword & Shield
  S1W: { englishParallelPriceChartingSlug: "pokemon-sword-shield", englishParallelSetName: "Sword & Shield" },
  S1H: { englishParallelPriceChartingSlug: "pokemon-sword-shield", englishParallelSetName: "Sword & Shield" },
  S2: { englishParallelPriceChartingSlug: "pokemon-rebel-clash", englishParallelSetName: "Rebel Clash" },
  S3: { englishParallelPriceChartingSlug: "pokemon-darkness-ablaze", englishParallelSetName: "Darkness Ablaze" },
  S4: { englishParallelPriceChartingSlug: "pokemon-vivid-voltage", englishParallelSetName: "Vivid Voltage" },
  S4A: { englishParallelPriceChartingSlug: "pokemon-shining-fates", englishParallelSetName: "Shining Fates" },
  S5I: { englishParallelPriceChartingSlug: "pokemon-battle-styles", englishParallelSetName: "Battle Styles" },
  S5R: { englishParallelPriceChartingSlug: "pokemon-battle-styles", englishParallelSetName: "Battle Styles" },
  S6H: { englishParallelPriceChartingSlug: "pokemon-chilling-reign", englishParallelSetName: "Chilling Reign" },
  S6K: { englishParallelPriceChartingSlug: "pokemon-chilling-reign", englishParallelSetName: "Chilling Reign" },
  S6A: { englishParallelPriceChartingSlug: "pokemon-evolving-skies", englishParallelSetName: "Evolving Skies" },
  S7D: { englishParallelPriceChartingSlug: "pokemon-evolving-skies", englishParallelSetName: "Evolving Skies" },
  S7R: { englishParallelPriceChartingSlug: "pokemon-evolving-skies", englishParallelSetName: "Evolving Skies" },
  S8: { englishParallelPriceChartingSlug: "pokemon-fusion-strike", englishParallelSetName: "Fusion Strike" },
  S8A: { englishParallelPriceChartingSlug: "pokemon-celebrations", englishParallelSetName: "Celebrations" },
  S8B: { englishParallelPriceChartingSlug: "pokemon-fusion-strike", englishParallelSetName: "Fusion Strike" },
  S9: { englishParallelPriceChartingSlug: "pokemon-brilliant-stars", englishParallelSetName: "Brilliant Stars" },
  S9A: { englishParallelPriceChartingSlug: "pokemon-brilliant-stars", englishParallelSetName: "Brilliant Stars" },
  S10D: { englishParallelPriceChartingSlug: "pokemon-astral-radiance", englishParallelSetName: "Astral Radiance" },
  S10P: { englishParallelPriceChartingSlug: "pokemon-astral-radiance", englishParallelSetName: "Astral Radiance" },
  S10B: { englishParallelPriceChartingSlug: "pokemon-pokemon-go", englishParallelSetName: "Pokemon GO" },
  S11: { englishParallelPriceChartingSlug: "pokemon-lost-origin", englishParallelSetName: "Lost Origin" },
  S11A: { englishParallelPriceChartingSlug: "pokemon-lost-origin", englishParallelSetName: "Lost Origin" },
  S12: { englishParallelPriceChartingSlug: "pokemon-silver-tempest", englishParallelSetName: "Silver Tempest" },
  S12A: { englishParallelPriceChartingSlug: "pokemon-crown-zenith", englishParallelSetName: "Crown Zenith" },
  // Scarlet & Violet
  SV1S: { englishParallelPriceChartingSlug: "pokemon-scarlet-violet", englishParallelSetName: "Scarlet & Violet" },
  SV1V: { englishParallelPriceChartingSlug: "pokemon-scarlet-violet", englishParallelSetName: "Scarlet & Violet" },
  SV2A: {
    englishParallelPriceChartingSlug: "pokemon-scarlet-&-violet-151",
    englishParallelPriceChartingSlugAliases: ["pokemon-151"],
    englishParallelSetName: "Pokemon 151",
  },
  SV2D: { englishParallelPriceChartingSlug: "pokemon-paldea-evolved", englishParallelSetName: "Paldea Evolved" },
  SV2P: { englishParallelPriceChartingSlug: "pokemon-paldea-evolved", englishParallelSetName: "Paldea Evolved" },
  SV3: { englishParallelPriceChartingSlug: "pokemon-obsidian-flames", englishParallelSetName: "Obsidian Flames" },
  SV3A: { englishParallelPriceChartingSlug: "pokemon-raging-surf", englishParallelSetName: "Raging Surf" },
  SV4K: { englishParallelPriceChartingSlug: "pokemon-paradox-rift", englishParallelSetName: "Paradox Rift" },
  SV4M: { englishParallelPriceChartingSlug: "pokemon-paradox-rift", englishParallelSetName: "Paradox Rift" },
  SV4A: { englishParallelPriceChartingSlug: "pokemon-shiny-treasure-ex", englishParallelSetName: "Shiny Treasure ex" },
  SV5K: { englishParallelPriceChartingSlug: "pokemon-temporal-forces", englishParallelSetName: "Temporal Forces" },
  SV5M: { englishParallelPriceChartingSlug: "pokemon-temporal-forces", englishParallelSetName: "Temporal Forces" },
  SV5A: { englishParallelPriceChartingSlug: "pokemon-twilight-masquerade", englishParallelSetName: "Twilight Masquerade" },
  SV6: { englishParallelPriceChartingSlug: "pokemon-twilight-masquerade", englishParallelSetName: "Twilight Masquerade" },
  SV6A: { englishParallelPriceChartingSlug: "pokemon-shrouded-fable", englishParallelSetName: "Shrouded Fable" },
  SV7: { englishParallelPriceChartingSlug: "pokemon-stellar-crown", englishParallelSetName: "Stellar Crown" },
  SV7A: { englishParallelPriceChartingSlug: "pokemon-stellar-crown", englishParallelSetName: "Stellar Crown" },
  SV8: { englishParallelPriceChartingSlug: "pokemon-surging-sparks", englishParallelSetName: "Surging Sparks" },
  SV8A: { englishParallelPriceChartingSlug: "pokemon-prismatic-evolutions", englishParallelSetName: "Prismatic Evolutions" },
  SV8M: { englishParallelPriceChartingSlug: "pokemon-surging-sparks", englishParallelSetName: "Surging Sparks" },
  SV8PT5: { englishParallelPriceChartingSlug: "pokemon-prismatic-evolutions", englishParallelSetName: "Prismatic Evolutions" },
  SV9: { englishParallelPriceChartingSlug: "pokemon-journey-together", englishParallelSetName: "Journey Together" },
  SV9A: { englishParallelPriceChartingSlug: "pokemon-journey-together", englishParallelSetName: "Journey Together" },
  SV10: { englishParallelPriceChartingSlug: "pokemon-destined-rivals", englishParallelSetName: "Destined Rivals" },
  SV11W: { englishParallelPriceChartingSlug: "pokemon-white-flare", englishParallelSetName: "White Flare" },
  SV11B: { englishParallelPriceChartingSlug: "pokemon-black-bolt", englishParallelSetName: "Black Bolt" },
  M1L: { englishParallelPriceChartingSlug: "pokemon-mega-brave", englishParallelSetName: "Mega Brave" },
  M1S: { englishParallelPriceChartingSlug: "pokemon-mega-symphonia", englishParallelSetName: "Mega Symphonia" },
  M2: { englishParallelPriceChartingSlug: "pokemon-inferno-x", englishParallelSetName: "Inferno X" },
  M2A: { englishParallelPriceChartingSlug: "pokemon-ascended-heroes", englishParallelSetName: "Ascended Heroes" },
  M3: { englishParallelPriceChartingSlug: "pokemon-perfect-order", englishParallelSetName: "Perfect Order" },
  M4: { englishParallelPriceChartingSlug: "pokemon-ninja-spinner", englishParallelSetName: "Ninja Spinner" },
  M5: { englishParallelPriceChartingSlug: "pokemon-pitch-black", englishParallelSetName: "Pitch Black" },
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
  SM11B: {
    englishName: "Dream League",
    priceChartingSlug: "pokemon-japanese-dream-league",
    aliases: ["Dream League", "ドリームリーグ", "SM11b", "SM11B"],
  },
  SM12: { englishName: "Alter Genesis", priceChartingSlug: "pokemon-japanese-alter-genesis", aliases: ["SM12 Alter Genesis"] },
  SM12A: {
    englishName: "Tag Team GX All Stars",
    priceChartingSlug: "pokemon-japanese-tag-all-stars",
    aliases: ["Tag All Stars", "TAG TEAM GX タッグオールスターズ", "SM12a", "SM12A"],
  },
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
  CEL25C: {
    englishName: "Celebrations",
    priceChartingSlug: "pokemon-celebrations",
    aliases: ["Celebrations", "Celebrations Classic Collection", "25th Anniversary", "Pokemon 25th"],
  },
  CEL25: {
    englishName: "Celebrations",
    priceChartingSlug: "pokemon-celebrations",
    aliases: ["Celebrations", "Celebrations Classic Collection"],
  },
  SWSH9TG: {
    englishName: "Brilliant Stars",
    priceChartingSlug: "pokemon-swsh-brilliant-stars",
    aliases: ["Brilliant Stars Trainer Gallery", "Trainer Gallery"],
  },
  SWSH10TG: {
    englishName: "Astral Radiance",
    priceChartingSlug: "pokemon-swsh-astral-radiance",
    aliases: ["Astral Radiance Trainer Gallery", "Trainer Gallery"],
  },
  SWSH11TG: {
    englishName: "Lost Origin",
    priceChartingSlug: "pokemon-swsh-lost-origin",
    aliases: ["Lost Origin Trainer Gallery", "Trainer Gallery"],
  },
  SWSH12TG: {
    englishName: "Silver Tempest",
    priceChartingSlug: "pokemon-swsh-silver-tempest",
    aliases: ["Silver Tempest Trainer Gallery", "Trainer Gallery"],
  },
  S9: { englishName: "Star Birth", priceChartingSlug: "pokemon-japanese-star-birth" },
  S10D: { englishName: "Time Gazer", priceChartingSlug: "pokemon-japanese-time-gazer" },
  S10P: { englishName: "Space Juggler", priceChartingSlug: "pokemon-japanese-space-juggler" },
  S11: { englishName: "Lost Abyss", priceChartingSlug: "pokemon-japanese-lost-abyss" },
  S12: { englishName: "Paradigm Trigger", priceChartingSlug: "pokemon-japanese-paradigm-trigger" },
  S12A: { englishName: "VSTAR Universe", priceChartingSlug: "pokemon-japanese-vstar-universe" },
  // Scarlet & Violet — already partially covered; extend common JP codes
  // Diamond & Pearl — Japanese DP4. Collectr lists this as Destined Skies;
  // PriceCharting uses Destroyed Sky. Keep both so Dex matches either label.
  "DPS-B": {
    englishName: "Intense Fight in the Destroyed Sky",
    priceChartingSlug: "pokemon-japanese-intense-fight-in-the-destroyed-sky",
    aliases: [
      "Intense Fight in the Destined Skies",
      "Destined Skies",
      "Destroyed Sky",
      "DPs-B",
    ],
  },
  NEO1: {
    englishName: "Gold, Silver, New World",
    priceChartingSlug: "pokemon-japanese-gold-silver-new-world",
    aliases: ["Neo Genesis"],
  },
  NEO2: {
    englishName: "Crossing the Ruins",
    priceChartingSlug: "pokemon-japanese-crossing-the-ruins",
    aliases: ["Neo Discovery"],
  },
  NEO3: {
    englishName: "Awakening Legends",
    priceChartingSlug: "pokemon-japanese-awakening-legends",
    aliases: ["Neo Revelation"],
  },
  NEO4: {
    englishName: "Darkness, and to Light",
    priceChartingSlug: "pokemon-japanese-darkness-and-to-light",
    aliases: ["Neo Destiny"],
  },
  SV1A: { englishName: "Triplet Beat", priceChartingSlug: "pokemon-japanese-triplet-beat" },
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
  M1L: { englishName: "Mega Brave", priceChartingSlug: "pokemon-japanese-mega-brave" },
  M1S: { englishName: "Mega Symphonia", priceChartingSlug: "pokemon-japanese-mega-symphonia" },
  M2: { englishName: "Inferno X", priceChartingSlug: "pokemon-japanese-inferno-x" },
  M2A: { englishName: "MEGA Dream ex", priceChartingSlug: "pokemon-japanese-mega-dream-ex" },
  M3: { englishName: "Nihil Zero", priceChartingSlug: "pokemon-japanese-nihil-zero" },
  M4: { englishName: "Ninja Spinner", priceChartingSlug: "pokemon-japanese-ninja-spinner" },
  M5: { englishName: "Abyss Eye", priceChartingSlug: "pokemon-japanese-abyss-eye" },
  // Classic / promo Japanese
  PMCG1: { englishName: "Expansion Pack" },
  PMCG2: { englishName: "Pokemon Jungle" },
  PMCG3: { englishName: "Mystery of the Fossils" },
  PMCG4: { englishName: "Rocket Gang" },
  PMCG5: { englishName: "Leaders' Stadium" },
  PMCG6: { englishName: "Challenge from the Darkness" },
  CP2: {
    englishName: "Legendary Shine Collection",
    priceChartingSlug: "pokemon-japanese-legendary-shine-collection",
    // Older catalog / UI labels sometimes say "Holo" instead of "Shine".
    aliases: ["Legendary Holo Collection", "CP2 Legendary Shine Collection"],
  },
  CSM1C: { englishName: "Gem Pack Vol. 1", priceChartingSlug: "pokemon-chinese-gem-pack" },
  CSM2C: { englishName: "Gem Pack Vol. 2", priceChartingSlug: "pokemon-chinese-gem-pack-2" },
  CBB2C: { englishName: "Gem Pack Vol. 2", priceChartingSlug: "pokemon-chinese-gem-pack-2" },
  CSM1A: { englishName: "Brave Stars" },
  CSM1B: { englishName: "Fearless Terastal" },
  SV2A: {
    englishName: "Pokemon Card 151",
    priceChartingSlug: "pokemon-japanese-scarlet-&-violet-151",
    priceChartingSlugAliases: [
      "pokemon-japanese-pokemon-card-151",
      "pokemon-japanese-151",
    ],
  },
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
  // English era promo / Black Star sets — game pages and PSA pop reports use different slugs.
  XYP: {
    englishName: "XY Black Star Promos",
    priceChartingSlug: "pokemon-promo",
    priceChartingSlugAliases: ["pokemon-xy-promo", "pokemon-xy-black-star-promos"],
    aliases: ["XY Promo", "Pokemon Promo", "XY Black Star Promo", "Black Star Promo"],
  },
  SMP: {
    englishName: "SM Black Star Promos",
    priceChartingSlug: "pokemon-promo",
    priceChartingSlugAliases: ["pokemon-sm-promo", "pokemon-sun-moon-promo"],
    aliases: ["SM Promo", "Sun & Moon Promo", "Black Star Promo"],
  },
  SWSHP: {
    englishName: "SWSH Black Star Promos",
    priceChartingSlug: "pokemon-promo",
    priceChartingSlugAliases: ["pokemon-swsh-promo", "pokemon-sword-shield-promo"],
    aliases: ["SWSH Promo", "Sword & Shield Promo", "Black Star Promo"],
  },
  SVP: {
    englishName: "SV Black Star Promos",
    priceChartingSlug: "pokemon-promo",
    priceChartingSlugAliases: ["pokemon-sv-promo", "pokemon-scarlet-violet-promo"],
    aliases: ["SV Promo", "Scarlet & Violet Promo", "Black Star Promo"],
  },
  "SV-P": {
    englishName: "Japanese SV Promo",
    priceChartingSlug: "pokemon-japanese-promo",
    aliases: ["SVP", "SV Promo", "Scarlet & Violet Promo"],
  },
  "SM-P": {
    englishName: "Japanese SM Promo",
    priceChartingSlug: "pokemon-japanese-promo",
    aliases: ["SMP", "SM Promo"],
  },
  "SWSH-P": {
    englishName: "Japanese SWSH Promo",
    priceChartingSlug: "pokemon-japanese-promo",
    aliases: ["SWSHP", "SWSH Promo"],
  },
  BWP: {
    englishName: "BW Black Star Promos",
    priceChartingSlug: "pokemon-promo",
    priceChartingSlugAliases: ["pokemon-bw-promo", "pokemon-black-white-promo"],
    aliases: ["BW Promo", "Black & White Promo", "Black Star Promo"],
  },
  HSP: {
    englishName: "HGSS Black Star Promos",
    priceChartingSlug: "pokemon-hgss-promo",
    priceChartingSlugAliases: ["pokemon-promo"],
    aliases: ["HGSS Promo", "HeartGold SoulSilver Promo", "Black Star Promo"],
  },
  DPP: {
    englishName: "DP Black Star Promos",
    priceChartingSlug: "pokemon-dp-promo",
    priceChartingSlugAliases: ["pokemon-promo"],
    aliases: ["DP Promo", "Diamond & Pearl Promo", "Black Star Promo"],
  },
  // English Scarlet & Violet / Mega Evolution sets that slugify poorly without
  // an explicit PriceCharting console path (e.g. "151" → pokemon-151 404).
  SV1: {
    englishName: "Scarlet & Violet",
    priceChartingSlug: "pokemon-scarlet-&-violet",
    aliases: ["Scarlet and Violet", "SV Base"],
  },
  SV2: { englishName: "Paldea Evolved", priceChartingSlug: "pokemon-paldea-evolved" },
  SV3PT5: {
    englishName: "151",
    priceChartingSlug: "pokemon-scarlet-&-violet-151",
    priceChartingSlugAliases: ["pokemon-151"],
    aliases: ["Pokemon 151", "SV3.5", "Scarlet & Violet 151"],
  },
  SV4: { englishName: "Paradox Rift", priceChartingSlug: "pokemon-paradox-rift" },
  SV4PT5: { englishName: "Paldean Fates", priceChartingSlug: "pokemon-paldean-fates" },
  SV5: { englishName: "Temporal Forces", priceChartingSlug: "pokemon-temporal-forces" },
  SV6PT5: { englishName: "Shrouded Fable", priceChartingSlug: "pokemon-shrouded-fable" },
  ME1: { englishName: "Mega Evolution", priceChartingSlug: "pokemon-mega-evolution" },
  ME2: { englishName: "Phantasmal Flames", priceChartingSlug: "pokemon-phantasmal-flames" },
  ME2PT5: {
    englishName: "Ascended Heroes",
    priceChartingSlug: "pokemon-ascended-heroes",
    aliases: ["ME02.5", "ME2.5"],
  },
  ME3: { englishName: "Perfect Order", priceChartingSlug: "pokemon-perfect-order" },
  ME4: { englishName: "Chaos Rising", priceChartingSlug: "pokemon-chaos-rising" },
  ME5: {
    englishName: "Pitch Black",
    priceChartingSlug: "pokemon-pitch-black",
    aliases: ["ME05", "PBL"],
  },
  ZSV10PT5: { englishName: "Black Bolt", priceChartingSlug: "pokemon-black-bolt" },
  RSV10PT5: { englishName: "White Flare", priceChartingSlug: "pokemon-white-flare" },
  SWSH12PT5: { englishName: "Crown Zenith", priceChartingSlug: "pokemon-crown-zenith" },
  // Pokemon TCG API uses CRZ for Crown Zenith (including Galarian Gallery prints).
  CRZ: {
    englishName: "Crown Zenith",
    priceChartingSlug: "pokemon-crown-zenith",
    aliases: ["Crown Zenith Galarian Gallery", "Galarian Gallery"],
  },
  SWSH45: { englishName: "Shining Fates", priceChartingSlug: "pokemon-shining-fates" },
  PGO: {
    englishName: "Pokemon GO",
    priceChartingSlug: "pokemon-go",
    aliases: ["Pokémon GO", "Pokemon Go"],
  },
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
    // Drop combining accents so "Pokémon" slugs as "pokemon", not "poke-mon".
    .replace(/[̀-ͯ]/g, "")
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

const SET_CODE_SYNONYMS: Record<string, string> = {
  BASE1: "BS",
  "ME02.5": "ME2PT5",
  "ME2.5": "ME2PT5",
  "SV03.5": "SV3PT5",
  "SV3.5": "SV3PT5",
  SVP: "SVP",
  "SV-P": "SV-P",
  "XY-P": "XYP",
  XYP: "XYP",
};

export function canonicalMarketSetCode(setCode?: string | null) {
  const key = setCode?.trim().toUpperCase() ?? "";
  return SET_CODE_SYNONYMS[key] ?? key;
}

export function getLocalizedSetMarketProfile(setCodeOrId: string): LocalizedSetMarketProfile | undefined {
  const key = canonicalMarketSetCode(setCodeOrId);
  const raw = setCodeOrId.trim().toUpperCase();
  return (
    LOCALIZED_SET_MARKET_PROFILES[key] ??
    LOCALIZED_SET_MARKET_PROFILES[raw] ??
    runtimeDiscoveredProfiles[key] ??
    runtimeDiscoveredProfiles[raw]
  );
}

/** True when a set has a PriceCharting (or English-parallel) market index we can price against. */
export function hasLocalizedMarketIndex(setCodeOrId?: string | null): boolean {
  if (!setCodeOrId?.trim()) {
    return false;
  }

  const profile = getLocalizedSetMarketProfile(setCodeOrId);
  const parallel = ENGLISH_PARALLEL_SET_LOOKUP[setCodeOrId.trim().toUpperCase()];

  return Boolean(
    profile?.priceChartingSlug ||
      profile?.priceChartingSlugAliases?.length ||
      profile?.englishParallelPriceChartingSlug ||
      parallel?.englishParallelPriceChartingSlug,
  );
}

export function getEnglishParallelSetMarketProfile(
  setCode: string,
): LocalizedSetMarketProfile | undefined {
  const key = setCode.trim().toUpperCase();
  const parallel = ENGLISH_PARALLEL_SET_LOOKUP[key];
  const base = getLocalizedSetMarketProfile(key);

  if (!parallel?.englishParallelPriceChartingSlug) {
    return undefined;
  }

  return {
    englishName: base?.englishName ?? parallel.englishParallelSetName ?? key,
    ...base,
    ...parallel,
  };
}

export type PriceChartingSetAttribution = "native" | "english_parallel" | "unknown";

function normalizePriceChartingSetSlug(value: string | undefined) {
  const clean = value?.trim().toLowerCase() ?? "";

  if (!clean) {
    return "";
  }

  try {
    const url = new URL(clean);
    const path = url.pathname.match(
      /^\/(?:game|console|pop\/item|pop\/set)\/([^/]+)/i,
    );
    return path?.[1]?.toLowerCase() ?? "";
  } catch {
    return clean.replace(/^\/+|\/+$/g, "");
  }
}

/**
 * Classify a PriceCharting console against the Japanese release represented by
 * `setCode`. English-parallel consoles are deliberately checked first: if a
 * legacy/static mapping ever lists the same slug in both places, ambiguity is
 * safer than silently presenting English values as Japanese market data.
 */
export function classifyLocalizedPriceChartingSetSlug(
  setCode: string | undefined,
  value: string | undefined,
): PriceChartingSetAttribution {
  const slug = normalizePriceChartingSetSlug(value);

  if (!slug) {
    return "unknown";
  }

  const parallel = setCode ? getEnglishParallelSetMarketProfile(setCode) : undefined;
  const parallelSlugs = new Set(
    [
      parallel?.englishParallelPriceChartingSlug,
      ...(parallel?.englishParallelPriceChartingSlugAliases ?? []),
    ]
      .map(normalizePriceChartingSetSlug)
      .filter(Boolean),
  );

  if (parallelSlugs.has(slug)) {
    return "english_parallel";
  }

  const profile = setCode ? getLocalizedSetMarketProfile(setCode) : undefined;
  const nativeSlugs = new Set(
    [profile?.priceChartingSlug, ...(profile?.priceChartingSlugAliases ?? [])]
      .map(normalizePriceChartingSetSlug)
      .filter(Boolean),
  );

  if (nativeSlugs.has(slug)) {
    return "native";
  }

  // A generic Japanese prefix is sufficient only for a genuinely unmapped set.
  // Once a set has an explicit native console, a different Japanese console is
  // a set conflict rather than another acceptable alias.
  if (nativeSlugs.size === 0 && /^pokemon-japanese-/.test(slug)) {
    return "native";
  }

  return "unknown";
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

/**
 * Aggressive normalization for matching a catalog set name against the
 * known-problem-set map: strips accents (Pokémon → pokemon), parentheticals,
 * punctuation, extra spaces, and leading "Pokemon"/"The" so that "Pokémon
 * Rumble", "Pokemon Rumble" and "Rumble" all resolve to the same key.
 */
export function normalizeSetNameForExternalLookup(setName: string) {
  return setName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[^a-z0-9&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^pokemon\s+/, "")
    .replace(/^the\s+/, "");
}

/**
 * Set names whose PriceCharting slug the generic slugifier can't derive —
 * mini-sets, vintage promos, and sets PriceCharting files under a different
 * name. Keys are `normalizeSetNameForExternalLookup` output. Extend this map
 * when a valid card reports NO MATCH from every generated slug variant.
 */
const PROBLEM_SET_SLUG_OVERRIDES: Record<string, string[]> = {
  rumble: ["pokemon-rumble"],
  "wizards black star promos": ["pokemon-promo"],
  "nintendo black star promos": ["pokemon-promo"],
  "black star promos": ["pokemon-promo"],
  "swsh black star promos": ["pokemon-promo"],
  "sm black star promos": ["pokemon-promo"],
  "sv black star promos": ["pokemon-promo"],
  "southern islands": ["pokemon-southern-islands"],
  // Numeric / short English set names that slugify to the wrong console path.
  "151": ["pokemon-scarlet-&-violet-151"],
  "pokemon 151": ["pokemon-scarlet-&-violet-151"],
  "pokemon go": ["pokemon-go"],
  "scarlet violet": ["pokemon-scarlet-&-violet"],
  "scarlet & violet": ["pokemon-scarlet-&-violet"],
  // Gallery subsets are filed under the parent English set on PriceCharting.
  "crown zenith galarian gallery": ["pokemon-crown-zenith"],
  "galarian gallery": ["pokemon-crown-zenith"],
  // CP2 is filed as Legendary Shine; some catalog rows still say Holo.
  "legendary holo collection": ["pokemon-japanese-legendary-shine-collection"],
  "legendary shine collection": ["pokemon-japanese-legendary-shine-collection"],
  "neo genesis": ["pokemon-japanese-gold-silver-new-world"],
  "neo discovery": ["pokemon-japanese-crossing-the-ruins"],
  "neo revelation": ["pokemon-japanese-awakening-legends"],
  "neo destiny": ["pokemon-japanese-darkness-and-to-light"],
  // PriceCharting drops the EX prefix (EX Deoxys → pokemon-deoxys).
  "ex deoxys": ["pokemon-deoxys"],
  deoxys: ["pokemon-deoxys"],
  "ex team rocket returns": ["pokemon-team-rocket-returns"],
  "team rocket returns": ["pokemon-team-rocket-returns"],
};

function promoSetSlugHints(setName: string): string[] {
  const normalized = setName.trim().toLowerCase();
  const hints: string[] = [];

  if (!/\b(?:black\s*star\s*promo|promo)\b/.test(normalized)) {
    return hints;
  }

  const eraMatch = normalized.match(
    /\b(xy|sm|swsh|sv|bw|dp|ex|hgss|sun\s*&\s*moon|sword\s*&\s*shield|scarlet\s*&\s*violet|black\s*&\s*white)\b/,
  );

  if (eraMatch) {
    const era = eraMatch[1]
      .replace(/\s*&\s*/g, "")
      .replace(/\s+/g, "")
      .replace("sunmoon", "sm")
      .replace("swordshield", "swsh")
      .replace("scarletviolet", "sv")
      .replace("blackwhite", "bw");

    hints.push(`pokemon-${era}-promo`);
  }

  hints.push("pokemon-promo");

  return hints;
}

export function getPriceChartingSetSlugVariants(
  setName: string,
  options: { setCode?: string; language?: string } = {},
): string[] {
  const setCode = options.setCode?.trim().toUpperCase() ?? "";
  const profile = setCode ? getLocalizedSetMarketProfile(setCode) : undefined;
  const candidates: string[] = [];
  const language = options.language?.toLowerCase() ?? "";
  const isImportLanguage =
    language === "ja" || language === "ko" || language.startsWith("zh");
  const prefersEnglishConsole =
    !language || language === "en" || language === "all";

  const pushSlug = (slug: string | undefined) => {
    if (!slug) {
      return;
    }
    // Shared set codes (e.g. SV9) often carry a Japanese profile. Do not lead
    // English lookups with pokemon-japanese-* / pokemon-korean-* consoles.
    if (
      prefersEnglishConsole &&
      /^pokemon-(japanese|korean|chinese)-/.test(slug)
    ) {
      return;
    }
    if (!isImportLanguage && /^pokemon-(japanese|korean|chinese)-/.test(slug)) {
      return;
    }
    candidates.push(slug);
  };

  pushSlug(profile?.priceChartingSlug);

  for (const aliasSlug of profile?.priceChartingSlugAliases ?? []) {
    pushSlug(aliasSlug);
  }

  const aggressiveKey = normalizeSetNameForExternalLookup(setName);

  for (const overrideSlug of PROBLEM_SET_SLUG_OVERRIDES[aggressiveKey] ?? []) {
    pushSlug(overrideSlug);
  }

  for (const hint of promoSetSlugHints(setName)) {
    candidates.push(hint);
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

  if (/celebrations/i.test(normalized)) {
    candidates.unshift("pokemon-celebrations");
  }

  if (/^base$/i.test(withoutPokemonPrefix) || setCode === "BS" || setCode === "BASE1") {
    candidates.unshift("pokemon-base-set");
  }

  if (/^expedition(?:\s+base\s+set)?$/i.test(withoutPokemonPrefix) || setCode === "ECARD1") {
    candidates.unshift("pokemon-expedition");
  }

  // PriceCharting files EX-era English sets without the "EX " prefix.
  const withoutExPrefix = withoutPokemonPrefix.replace(/^ex\s+/i, "").trim();
  if (withoutExPrefix && withoutExPrefix !== withoutPokemonPrefix) {
    const exSetSlug = slugifyForMarket(withoutExPrefix);
    if (exSetSlug) {
      candidates.unshift(`pokemon-${exSetSlug}`);
    }
  }

  if (/vivid voltage/i.test(normalized) || setCode === "SWSH4") {
    candidates.unshift("pokemon-vivid-voltage", "pokemon-swsh-vivid-voltage");
  }

  const trainerGalleryParent = normalized.match(/^(.+?)\s+trainer\s+gallery$/i);

  if (trainerGalleryParent?.[1]?.trim()) {
    const parentSlug = slugifyForMarket(trainerGalleryParent[1].trim());
    candidates.unshift(`pokemon-swsh-${parentSlug}`);
    candidates.unshift(`pokemon-${parentSlug}`);
  }

  const galarianGalleryParent = normalized.match(/^(.+?)\s+galarian\s+gallery$/i);

  if (galarianGalleryParent?.[1]?.trim()) {
    const parentSlug = slugifyForMarket(galarianGalleryParent[1].trim());
    candidates.unshift(`pokemon-${parentSlug}`);
  }

  const rawSlug = slugifyForMarket(normalized);
  // Derive from the slug (accents already stripped) so "Pokémon Rumble" can't
  // produce a doubled "pokemon-pokemon-rumble" variant.
  const setOnlySlug = rawSlug.replace(/^pokemon-/, "");

  candidates.push(
    rawSlug.startsWith("pokemon-") ? rawSlug : `pokemon-${rawSlug}`,
    setOnlySlug ? `pokemon-${setOnlySlug}` : "",
    rawSlug,
  );

  if (setCode) {
    candidates.push(`pokemon-${setCode.toLowerCase()}`);
  }

  // Loosest variants last: the parenthetical/punctuation-stripped form and the
  // bare set-only slug catch renamed or oddly-punctuated catalog set names
  // without displacing the higher-confidence candidates above.
  const aggressiveSlug = slugifyForMarket(aggressiveKey);

  if (aggressiveSlug) {
    candidates.push(`pokemon-${aggressiveSlug}`, aggressiveSlug);
  }

  if (setOnlySlug) {
    candidates.push(setOnlySlug);
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
  name?: string;
  localizedName?: string;
  collectorNumber?: string;
  setPrintedTotal?: number;
  setTotal?: number;
  language?: string;
}): boolean {
  const price = card.marketPriceUsd;

  if (!(price > 0)) {
    return false;
  }

  const rarity = (card.rarity ?? "").toLowerCase();
  const setName = (card.setName ?? "").toLowerCase();
  const name = `${card.name ?? ""} ${card.localizedName ?? ""}`.toLowerCase();
  const collector = Number.parseInt(String(card.collectorNumber ?? "").replace(/[^\d]/g, ""), 10);
  const printed = card.setPrintedTotal ?? card.setTotal ?? 0;
  const looksChase =
    (Number.isFinite(collector) && printed > 0 && collector > printed) ||
    /\b(ex|vmax|vstar|sar|sir)\b/i.test(`${rarity} ${name}`) ||
    /star|secret rare|special illustration|illustration rare|hyper rare|rainbow|gold star/i.test(
      rarity,
    );

  // TCGdex JP Cardmarket often returns ~€0.20 lows for chase cards. Treat
  // sub-$25 chase catalog as missing so PriceCharting guide enrichment runs.
  if (looksChase && price < 25) {
    return true;
  }

  if (
    /star|secret rare|special illustration|illustration rare|hyper rare|rainbow|gold star/i.test(
      rarity,
    ) &&
    price < 250
  ) {
    return true;
  }

  // Non-English catalog under $1 is never trustworthy for set price-sort.
  if (card.language && card.language !== "en" && price < 1) {
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
    isJapanese?: boolean;
  } = {},
): boolean {
  if (!(catalogPriceUsd >= 1)) {
    return false;
  }

  // Absurd-collapse floor: a real catalog price must never be cratered to a small
  // fraction by a thin, sold-comp-less estimate (e.g. a stale/mismatched guide
  // while PriceCharting is blocked). This holds even when the catalog is not
  // sold-trusted — a >70% drop on <2 sold comps is broken data, not a market.
  if (incomingPriceUsd < catalogPriceUsd * 0.3 && (options.soldCompCount ?? 0) < 2) {
    return true;
  }

  if (!options.catalogTrusted) {
    return false;
  }

  if ((options.soldCompCount ?? 0) >= 4) {
    return false;
  }

  // Japanese TCGdex / companion catalog prices are often wrong for imports.
  // Only preserve catalog when sold comps corroborate it.
  if (options.isJapanese && (options.soldCompCount ?? 0) < 2) {
    return false;
  }

  // Only block downward moves from thin guide snapshots — never reject a higher
  // enrichment price when the catalog baseline was a bad strict-match or rarity floor.
  return incomingPriceUsd < catalogPriceUsd * 0.55;
}

/** Thin Magery/sold-comp blends must not crush a much higher finish-specific guide. */
export function consensusCanReplaceCatalogMarket(market: number, consensus: number) {
  return !(market > 0) || consensus >= market * 0.5;
}

function hasTrustedJapaneseGuideEvidence(card: {
  gradedPrices?: Array<{ grade: string; value: number; source?: string; confidenceScore?: number }>;
  priceConsensus?: {
    finalEstimateUsd: number;
    confidenceScore?: number;
    sources?: Array<{ source?: string; confidenceScore?: number; evidenceType?: string }>;
  };
}) {
  const guideSources = card.priceConsensus?.sources?.some(
    (source) =>
      /pricecharting/i.test(source.source ?? "") &&
      ((source.confidenceScore ?? 0) >= 0.5 || source.evidenceType === "guide_snapshot"),
  );

  const guideUngraded = card.gradedPrices?.some(
    (price) =>
      price.grade === "Ungraded" &&
      price.value > 0 &&
      /pricecharting/i.test(price.source ?? ""),
  );

  return Boolean(guideSources || guideUngraded);
}

export function getHeadlineMarketPriceUsd(card: {
  marketPriceUsd: number;
  language?: string;
  gradedPrices?: Array<{ grade: string; value: number; source?: string; confidenceScore?: number }>;
  priceConsensus?: {
    finalEstimateUsd: number;
    confidenceScore?: number;
    methodology?: string;
    sources?: Array<{ source?: string; confidenceScore?: number; evidenceType?: string }>;
  };
}): number {
  const market = card.marketPriceUsd > 0 ? card.marketPriceUsd : 0;
  const ungraded = card.gradedPrices?.find((price) => price.grade === "Ungraded");
  const consensus = card.priceConsensus?.finalEstimateUsd ?? 0;
  const soldCompSources =
    card.priceConsensus?.sources?.filter((source) => source.evidenceType === "sold_comp") ?? [];
  const hasSoldCompConsensus =
    consensus > 0 &&
    (soldCompSources.length > 0 ||
      /sold[- ]?comp/i.test(card.priceConsensus?.methodology ?? ""));
  const isLocalized = Boolean(card.language && card.language !== "en");
  const consensusRejectsCatalogBaseline = /catalog baseline looked like/i.test(
    card.priceConsensus?.methodology ?? "",
  );

  if (consensusRejectsCatalogBaseline && consensus > 0) {
    return consensus;
  }

  // Sold-comp / multi-source consensus wins over a thin Ungraded guide row so
  // Raw Market, Grade Values, and the chart share one number. A much lower
  // blend (often Unlimited sold comps on a 1st Edition print) must not replace
  // the finish-specific guide — Dex had $6,500 while details showed ~$425.
  if (hasSoldCompConsensus && consensusCanReplaceCatalogMarket(market, consensus)) {
    return consensus;
  }

  if (
    consensus > 0 &&
    (card.priceConsensus?.confidenceScore ?? 0) >= 0.55 &&
    (card.priceConsensus?.sources?.length ?? 0) >= 2 &&
    consensusCanReplaceCatalogMarket(market, consensus)
  ) {
    return consensus;
  }

  const enriched = Math.max(ungraded?.value ?? 0, consensus);

  if (isLocalized && hasTrustedJapaneseGuideEvidence(card) && enriched > 0) {
    return enriched;
  }

  const upliftThreshold = isLocalized ? 1.04 : 1.15;

  if (enriched > market * upliftThreshold) {
    return enriched;
  }

  return market > 0 ? market : enriched;
}
