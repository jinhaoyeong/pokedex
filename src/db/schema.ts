import {
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
