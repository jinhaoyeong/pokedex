-- Review queue for withheld identity failures and widened PSA estimate conflicts.
-- No product UI in this release; rows are for later human review.

CREATE TABLE IF NOT EXISTS "market_estimate_diagnostics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "fingerprint" text NOT NULL,
  "card_slug" text NOT NULL,
  "grade" text NOT NULL,
  "reason_code" text NOT NULL,
  "outcome" text NOT NULL,
  "evidence" jsonb,
  "occurrence_count" integer DEFAULT 1 NOT NULL,
  "first_seen_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "review_status" text DEFAULT 'pending' NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "market_estimate_diagnostics_fingerprint_unique"
  ON "market_estimate_diagnostics" USING btree ("fingerprint");
CREATE INDEX IF NOT EXISTS "market_estimate_diagnostics_card_idx"
  ON "market_estimate_diagnostics" USING btree ("card_slug","grade");
CREATE INDEX IF NOT EXISTS "market_estimate_diagnostics_review_idx"
  ON "market_estimate_diagnostics" USING btree ("review_status","last_seen_at");
