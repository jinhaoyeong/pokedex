CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "card_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"field" text NOT NULL,
	"reported_value" text,
	"note" text,
	"correction_type" text,
	"parsed_json" jsonb,
	"confidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_learning_cache" (
	"slug" text PRIMARY KEY NOT NULL,
	"language_code" text NOT NULL,
	"collector_number" text,
	"printed_total" integer,
	"card_json" jsonb NOT NULL,
	"query_text" text,
	"search_blob" text,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"last_searched_at" timestamp with time zone NOT NULL,
	"enriched_at" timestamp with time zone,
	"identity_status" text DEFAULT 'estimated' NOT NULL,
	"price_status" text DEFAULT 'estimated' NOT NULL,
	"trust_score" numeric(6, 4) DEFAULT '0.5000' NOT NULL,
	"search_hits" integer DEFAULT 0 NOT NULL,
	"detail_views" integer DEFAULT 0 NOT NULL,
	"wrong_price_flags" integer DEFAULT 0 NOT NULL,
	"wrong_card_flags" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards_catalog" (
	"slug" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"language_code" text NOT NULL,
	"set_id" text NOT NULL,
	"set_code" text NOT NULL,
	"collector_number" text NOT NULL,
	"printed_total" integer,
	"name" text NOT NULL,
	"english_name" text,
	"localized_name" text,
	"rarity" text,
	"supertype" text,
	"image_url" text,
	"release_year" integer,
	"search_text" text DEFAULT '' NOT NULL,
	"market_price_usd" numeric(12, 2),
	"card_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_card_hits" (
	"query_normalized" text NOT NULL,
	"slug" text NOT NULL,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"last_hit_at" timestamp with time zone NOT NULL,
	CONSTRAINT "query_card_hits_query_normalized_slug_pk" PRIMARY KEY("query_normalized","slug")
);
--> statement-breakpoint
CREATE TABLE "search_responses" (
	"key" text PRIMARY KEY NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"set_filter" text DEFAULT '' NOT NULL,
	"page" integer DEFAULT 1 NOT NULL,
	"language" text DEFAULT 'all' NOT NULL,
	"sort" text DEFAULT 'relevance' NOT NULL,
	"response_json" jsonb NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "card_corrections_slug_idx" ON "card_corrections" USING btree ("slug","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_corrections_dedupe_idx" ON "card_corrections" USING btree ("slug","field","reported_value","correction_type","created_at");--> statement-breakpoint
CREATE INDEX "card_learning_collector_idx" ON "card_learning_cache" USING btree ("language_code","collector_number","printed_total");--> statement-breakpoint
CREATE INDEX "card_learning_hits_idx" ON "card_learning_cache" USING btree ("hit_count","trust_score");--> statement-breakpoint
CREATE INDEX "card_learning_refresh_idx" ON "card_learning_cache" USING btree ("wrong_price_flags","wrong_card_flags","enriched_at");--> statement-breakpoint
CREATE INDEX "cards_catalog_language_idx" ON "cards_catalog" USING btree ("language_code");--> statement-breakpoint
CREATE INDEX "cards_catalog_set_idx" ON "cards_catalog" USING btree ("set_id","set_code");--> statement-breakpoint
CREATE INDEX "cards_catalog_collector_idx" ON "cards_catalog" USING btree ("language_code","collector_number","printed_total");--> statement-breakpoint
CREATE INDEX "cards_catalog_price_idx" ON "cards_catalog" USING btree ("market_price_usd");--> statement-breakpoint
CREATE INDEX "cards_catalog_release_idx" ON "cards_catalog" USING btree ("release_year");--> statement-breakpoint
CREATE INDEX "cards_catalog_search_text_trgm_idx" ON "cards_catalog" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cards_catalog_name_trgm_idx" ON "cards_catalog" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cards_catalog_english_name_trgm_idx" ON "cards_catalog" USING gin ("english_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cards_catalog_localized_name_trgm_idx" ON "cards_catalog" USING gin ("localized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "card_learning_search_blob_trgm_idx" ON "card_learning_cache" USING gin ("search_blob" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "query_card_hits_query_idx" ON "query_card_hits" USING btree ("query_normalized","hit_count");--> statement-breakpoint
CREATE INDEX "search_responses_lookup_idx" ON "search_responses" USING btree ("language","set_filter","query","sort","page");--> statement-breakpoint
CREATE INDEX "search_responses_updated_idx" ON "search_responses" USING btree ("updated_at");
