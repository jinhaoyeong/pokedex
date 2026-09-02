-- First-party PokePokedex market observations: binder/vault reports that
-- populate Grade Values without PriceCharting. Grade + contributor key let
-- us keep one vote per collector per print and aggregate anonymously.

ALTER TABLE "market_observations" ADD COLUMN IF NOT EXISTS "grade" text DEFAULT 'Ungraded' NOT NULL;
ALTER TABLE "market_observations" ADD COLUMN IF NOT EXISTS "contributor_key" text DEFAULT '' NOT NULL;
ALTER TABLE "market_observations" ADD COLUMN IF NOT EXISTS "set_code" text;
ALTER TABLE "market_observations" ADD COLUMN IF NOT EXISTS "collector_number" text;
ALTER TABLE "market_observations" ADD COLUMN IF NOT EXISTS "language" text;
ALTER TABLE "market_observations" ADD COLUMN IF NOT EXISTS "card_name" text;
CREATE INDEX IF NOT EXISTS "market_observations_card_grade_idx" ON "market_observations" USING btree ("card_slug","grade","kind");
CREATE UNIQUE INDEX IF NOT EXISTS "market_observations_contributor_unique" ON "market_observations" USING btree ("contributor_key","card_slug","grade","kind");
CREATE INDEX IF NOT EXISTS "market_observations_print_idx" ON "market_observations" USING btree ("set_code","collector_number","language");
