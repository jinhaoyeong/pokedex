CREATE TABLE "api_price_cache" (
	"card_slug" text PRIMARY KEY NOT NULL,
	"language" text,
	"set_code" text,
	"ungraded_usd" numeric(12, 2),
	"confidence_score" numeric(6, 4),
	"primary_provider" text,
	"results_json" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_identity_mappings" (
	"official_card_id" text PRIMARY KEY NOT NULL,
	"printed_collector_number" text,
	"set_code" text,
	"english_name" text,
	"price_charting_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_price_cache_updated_idx" ON "api_price_cache" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "card_identity_mappings_set_code_idx" ON "card_identity_mappings" USING btree ("set_code");