import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
 * cardID -> printed collector number / set code / English name. Rows are
 * written once on first live resolution and read forever after.
 */
export const cardIdentityMappings = pgTable(
  "card_identity_mappings",
  {
    officialCardId: text("official_card_id").primaryKey(),
    printedCollectorNumber: text("printed_collector_number"),
    setCode: text("set_code"),
    englishName: text("english_name"),
    priceChartingSlug: text("price_charting_slug"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("card_identity_mappings_set_code_idx").on(table.setCode)],
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
