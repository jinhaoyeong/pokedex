ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "browse_index" integer;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "japanese_name" text;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "collector_number_total" integer;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "japanese_set_name" text;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "english_set_name" text;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "price_charting_product_id" text;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "price_charting_product_url" text;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "identity_confidence" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "identity_source" jsonb;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "identity_status" text;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_identity_mappings" ADD COLUMN IF NOT EXISTS "identity_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_identity_mappings_pc_product_idx" ON "card_identity_mappings" USING btree ("price_charting_product_id");
