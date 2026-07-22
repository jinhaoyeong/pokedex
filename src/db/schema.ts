import {
  boolean,
  bit,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Portfolio foundation schema (Supabase PostgreSQL).
 *
 * Money is stored as numeric(12,2) in USD. Portfolio totals are never stored;
 * they are computed dynamically from portfolio_items x latest price_snapshots
 * and from the portfolio_transactions ledger.
 */

export const portfolioTransactionType = pgEnum("portfolio_transaction_type", [
  "buy",
  "sell",
  "adjustment",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_clerk_user_id_unique").on(table.clerkUserId)],
);

export const portfolioItems = pgTable(
  "portfolio_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardSlug: text("card_slug").notNull(),
    cardName: text("card_name"),
    setName: text("set_name"),
    language: text("language"),
    // Matches the binder grade labels used across the app, e.g. "Ungraded", "PSA 10".
    grade: text("grade").notNull().default("Ungraded"),
    quantity: integer("quantity").notNull().default(0),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("portfolio_items_user_card_grade_unique").on(
      table.userId,
      table.cardSlug,
      table.grade,
    ),
    index("portfolio_items_user_id_idx").on(table.userId),
  ],
);

export const portfolioTransactions = pgTable(
  "portfolio_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    portfolioItemId: uuid("portfolio_item_id")
      .notNull()
      .references(() => portfolioItems.id, { onDelete: "cascade" }),
    type: portfolioTransactionType("type").notNull(),
    quantity: integer("quantity").notNull(),
    pricePerUnitUsd: numeric("price_per_unit_usd", { precision: 12, scale: 2 }),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("portfolio_transactions_item_id_idx").on(table.portfolioItemId),
    index("portfolio_transactions_user_id_idx").on(table.userId),
  ],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardSlug: text("card_slug").notNull(),
    cardName: text("card_name"),
    targetPriceUsd: numeric("target_price_usd", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("watchlist_items_user_card_unique").on(table.userId, table.cardSlug),
  ],
);

export const userSettings = pgTable(
  "user_settings",
  {
    clerkId: text("clerk_id")
      .primaryKey()
      .references(() => users.clerkUserId, { onDelete: "cascade" }),
    preferredCurrency: text("preferred_currency").notNull().default("MYR"),
    layoutPreferences: jsonb("layout_preferences")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const binderCards = pgTable(
  "binder_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkId: text("clerk_id")
      .notNull()
      .references(() => users.clerkUserId, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    name: text("name").notNull(),
    imageUrl: text("image_url").notNull(),
    marketPrice: numeric("market_price", { precision: 12, scale: 2 }),
    quantity: integer("quantity").notNull().default(1),
    notes: text("notes"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("binder_cards_clerk_card_unique").on(table.clerkId, table.cardId),
    index("binder_cards_clerk_id_idx").on(table.clerkId),
  ],
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardSlug: text("card_slug").notNull(),
    grade: text("grade").notNull().default("Ungraded"),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    source: text("source"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("price_snapshots_card_grade_captured_idx").on(
      table.cardSlug,
      table.grade,
      table.capturedAt,
    ),
  ],
);

/**
 * Persistent multi-source price cache (ports data/pokemon-prices-cache.sqlite
 * to Supabase so warmed prices survive serverless instance recycling). One row
 * per card slug holding the latest ResolvedPrice; the full provider results
 * array is kept as jsonb so the overlay/selection logic can re-run untouched.
 */
export const apiPriceCache = pgTable(
  "api_price_cache",
  {
    cardSlug: text("card_slug").primaryKey(),
    language: text("language"),
    setCode: text("set_code"),
    ungradedUsd: numeric("ungraded_usd", { precision: 12, scale: 2 }),
    confidenceScore: numeric("confidence_score", { precision: 6, scale: 4 }),
    primaryProvider: text("primary_provider"),
    resultsJson: jsonb("results_json"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_price_cache_updated_idx").on(table.updatedAt)],
);

/**
 * Official-Japanese card identity mappings. Replaces the per-request live
 * pokemon-card.com round-trip in the /api/price hydration step: official
 * cardID -> canonical Japanese catalog/market identity. Identity versions
 * advance when a confirmed material field changes so dependent market caches
 * can move to a new namespace instead of retaining a stale match.
 */
export const cardIdentityMappings = pgTable(
  "card_identity_mappings",
  {
    officialCardId: text("official_card_id").primaryKey(),
    browseIndex: integer("browse_index"),
    japaneseName: text("japanese_name"),
    printedCollectorNumber: text("printed_collector_number"),
    collectorNumberTotal: integer("collector_number_total"),
    setCode: text("set_code"),
    japaneseSetName: text("japanese_set_name"),
    englishName: text("english_name"),
    englishSetName: text("english_set_name"),
    priceChartingSlug: text("price_charting_slug"),
    priceChartingProductId: text("price_charting_product_id"),
    priceChartingProductUrl: text("price_charting_product_url"),
    identityConfidence: numeric("identity_confidence", { precision: 6, scale: 4 }),
    identitySource: jsonb("identity_source"),
    identityStatus: text("identity_status"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    identityVersion: integer("identity_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("card_identity_mappings_set_code_idx").on(table.setCode),
    index("card_identity_mappings_pc_product_idx").on(table.priceChartingProductId),
  ],
);

/**
 * Persistent grading/population cache (ports the in-memory market-result cache
 * and data/pokemon-psa-population.sqlite to Supabase). `kind` separates the
 * two payload shapes sharing this table:
 *   - "market_result":        a full LivePsaDataResult keyed by the composite
 *                             market cache key (the 20-40s scrape artifact)
 *   - "population_snapshot":  a parsed PriceCharting population snapshot keyed
 *                             by buildPopulationKey()
 * `has_signal` drives the smart TTL: rows with real data stay fresh for days,
 * empty rows (bot-wall / no-match) are short-lived negative cache entries so a
 * blocked host isn't re-scraped on every view but can self-heal quickly.
 */
export const apiPopulationCache = pgTable(
  "api_population_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    kind: text("kind").notNull().default("market_result"),
    language: text("language"),
    setCode: text("set_code"),
    hasSignal: boolean("has_signal").notNull().default(false),
    gradingDataJson: jsonb("grading_data_json").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_population_cache_updated_idx").on(table.updatedAt)],
);

export const marketObservations = pgTable(
  "market_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardSlug: text("card_slug").notNull(),
    source: text("source").notNull(),
    // e.g. "sold_listing", "active_listing", "index_price"
    kind: text("kind").notNull(),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    metadata: jsonb("metadata"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("market_observations_card_observed_idx").on(table.cardSlug, table.observedAt),
  ],
);

export const cardsCatalog = pgTable(
  "cards_catalog",
  {
    slug: text("slug").primaryKey(),
    cardId: text("card_id").notNull(),
    languageCode: text("language_code").notNull(),
    setId: text("set_id").notNull(),
    setCode: text("set_code").notNull(),
    collectorNumber: text("collector_number").notNull(),
    printedTotal: integer("printed_total"),
    name: text("name").notNull(),
    englishName: text("english_name"),
    localizedName: text("localized_name"),
    rarity: text("rarity"),
    supertype: text("supertype"),
    imageUrl: text("image_url"),
    releaseYear: integer("release_year"),
    searchText: text("search_text").notNull().default(""),
    marketPriceUsd: numeric("market_price_usd", { precision: 12, scale: 2 }),
    cardJson: jsonb("card_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cards_catalog_language_idx").on(table.languageCode),
    index("cards_catalog_set_idx").on(table.setId, table.setCode),
    index("cards_catalog_collector_idx").on(
      table.languageCode,
      table.collectorNumber,
      table.printedTotal,
    ),
    index("cards_catalog_price_idx").on(table.marketPriceUsd),
    index("cards_catalog_release_idx").on(table.releaseYear),
  ],
);

export const cardVisuals = pgTable(
  "card_visuals",
  {
    cardId: text("card_id").primaryKey(),
    name: text("name").notNull(),
    setId: text("set_id"),
    setName: text("set_name"),
    localId: text("local_id"),
    lang: text("lang").notNull(),
    image: text("image"),
    hash: text("hash").notNull(),
    hashBits: bit("hash_bits", { dimensions: 64 }).notNull(),
    embedding: vector("embedding", { dimensions: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("card_visuals_lang_local_idx").on(table.lang, table.localId),
    index("card_visuals_name_idx").on(table.name),
    index("card_visuals_updated_idx").on(table.updatedAt),
  ],
);

export const pokemonNamesDict = pgTable(
  "pokemon_names_dict",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    speciesId: integer("species_id"),
    pokeapiLanguage: text("pokeapi_language"),
    appLanguage: text("app_language"),
    localizedName: text("localized_name").notNull(),
    localizedNormalized: text("localized_normalized").notNull(),
    englishName: text("english_name").notNull(),
    englishNormalized: text("english_normalized").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pokemon_names_dict_unique").on(
      table.kind,
      table.speciesId,
      table.pokeapiLanguage,
      table.localizedName,
      table.appLanguage,
    ),
    index("pokemon_names_localized_idx").on(table.localizedNormalized, table.appLanguage),
    index("pokemon_names_english_idx").on(table.englishNormalized),
    index("pokemon_names_species_idx").on(table.speciesId),
  ],
);

export const pokemonSetsDict = pgTable(
  "pokemon_sets_dict",
  {
    setId: text("set_id").notNull(),
    languageCode: text("language_code").notNull(),
    name: text("name").notNull(),
    englishName: text("english_name"),
    code: text("code").notNull(),
    series: text("series"),
    releaseDate: text("release_date").notNull().default(""),
    printedTotal: integer("printed_total"),
    total: integer("total"),
    searchText: text("search_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.setId, table.languageCode] }),
    index("pokemon_sets_lang_release_idx").on(table.languageCode, table.releaseDate),
    index("pokemon_sets_code_idx").on(table.code),
    index("pokemon_sets_search_idx").on(table.searchText),
  ],
);

export const cardLearningCache = pgTable(
  "card_learning_cache",
  {
    slug: text("slug").primaryKey(),
    languageCode: text("language_code").notNull(),
    collectorNumber: text("collector_number"),
    printedTotal: integer("printed_total"),
    cardJson: jsonb("card_json").notNull(),
    queryText: text("query_text"),
    searchBlob: text("search_blob"),
    hitCount: integer("hit_count").notNull().default(1),
    lastSearchedAt: timestamp("last_searched_at", { withTimezone: true }).notNull(),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    identityStatus: text("identity_status").notNull().default("estimated"),
    priceStatus: text("price_status").notNull().default("estimated"),
    trustScore: numeric("trust_score", { precision: 6, scale: 4 }).notNull().default("0.5000"),
    searchHits: integer("search_hits").notNull().default(0),
    detailViews: integer("detail_views").notNull().default(0),
    wrongPriceFlags: integer("wrong_price_flags").notNull().default(0),
    wrongCardFlags: integer("wrong_card_flags").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("card_learning_collector_idx").on(
      table.languageCode,
      table.collectorNumber,
      table.printedTotal,
    ),
    index("card_learning_hits_idx").on(table.hitCount, table.trustScore),
    index("card_learning_refresh_idx").on(
      table.wrongPriceFlags,
      table.wrongCardFlags,
      table.enrichedAt,
    ),
  ],
);

export const cardCorrections = pgTable(
  "card_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    field: text("field").notNull(),
    reportedValue: text("reported_value"),
    note: text("note"),
    correctionType: text("correction_type"),
    parsedJson: jsonb("parsed_json"),
    confidence: text("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("card_corrections_slug_idx").on(table.slug, table.createdAt),
    uniqueIndex("card_corrections_dedupe_idx").on(
      table.slug,
      table.field,
      table.reportedValue,
      table.correctionType,
      table.createdAt,
    ),
  ],
);

export const queryCardHits = pgTable(
  "query_card_hits",
  {
    queryNormalized: text("query_normalized").notNull(),
    slug: text("slug").notNull(),
    hitCount: integer("hit_count").notNull().default(1),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.queryNormalized, table.slug] }),
    index("query_card_hits_query_idx").on(table.queryNormalized, table.hitCount),
  ],
);

export const searchResponses = pgTable(
  "search_responses",
  {
    key: text("key").primaryKey(),
    query: text("query").notNull().default(""),
    setFilter: text("set_filter").notNull().default(""),
    page: integer("page").notNull().default(1),
    language: text("language").notNull().default("all"),
    sort: text("sort").notNull().default("relevance"),
    responseJson: jsonb("response_json").notNull(),
    resultCount: integer("result_count").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("search_responses_lookup_idx").on(
      table.language,
      table.setFilter,
      table.query,
      table.sort,
      table.page,
    ),
    index("search_responses_updated_idx").on(table.updatedAt),
  ],
);
