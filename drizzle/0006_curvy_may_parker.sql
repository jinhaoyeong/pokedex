CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "card_visuals" (
	"card_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"set_id" text,
	"set_name" text,
	"local_id" text,
	"lang" text NOT NULL,
	"image" text,
	"hash" text NOT NULL,
	"hash_bits" bit(64) NOT NULL,
	"embedding" vector(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "card_visuals_lang_local_idx" ON "card_visuals" USING btree ("lang","local_id");--> statement-breakpoint
CREATE INDEX "card_visuals_name_idx" ON "card_visuals" USING btree ("name");--> statement-breakpoint
CREATE INDEX "card_visuals_updated_idx" ON "card_visuals" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "card_visuals_embedding_hnsw_idx" ON "card_visuals" USING hnsw ("embedding" vector_cosine_ops);
