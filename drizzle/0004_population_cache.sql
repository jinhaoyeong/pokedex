CREATE TABLE "api_population_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'market_result' NOT NULL,
	"language" text,
	"set_code" text,
	"has_signal" boolean DEFAULT false NOT NULL,
	"grading_data_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_population_cache_updated_idx" ON "api_population_cache" USING btree ("updated_at");