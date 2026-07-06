CREATE TABLE "pokemon_names_dict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"species_id" integer,
	"pokeapi_language" text,
	"app_language" text,
	"localized_name" text NOT NULL,
	"localized_normalized" text NOT NULL,
	"english_name" text NOT NULL,
	"english_normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pokemon_sets_dict" (
	"set_id" text NOT NULL,
	"language_code" text NOT NULL,
	"name" text NOT NULL,
	"english_name" text,
	"code" text NOT NULL,
	"series" text,
	"release_date" text DEFAULT '' NOT NULL,
	"printed_total" integer,
	"total" integer,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pokemon_sets_dict_set_id_language_code_pk" PRIMARY KEY("set_id","language_code")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pokemon_names_dict_unique" ON "pokemon_names_dict" USING btree ("kind","species_id","pokeapi_language","localized_name","app_language");--> statement-breakpoint
CREATE INDEX "pokemon_names_localized_idx" ON "pokemon_names_dict" USING btree ("localized_normalized","app_language");--> statement-breakpoint
CREATE INDEX "pokemon_names_english_idx" ON "pokemon_names_dict" USING btree ("english_normalized");--> statement-breakpoint
CREATE INDEX "pokemon_names_species_idx" ON "pokemon_names_dict" USING btree ("species_id");--> statement-breakpoint
CREATE INDEX "pokemon_sets_lang_release_idx" ON "pokemon_sets_dict" USING btree ("language_code","release_date");--> statement-breakpoint
CREATE INDEX "pokemon_sets_code_idx" ON "pokemon_sets_dict" USING btree ("code");--> statement-breakpoint
CREATE INDEX "pokemon_sets_search_idx" ON "pokemon_sets_dict" USING btree ("search_text");--> statement-breakpoint
CREATE INDEX "pokemon_names_localized_trgm_idx" ON "pokemon_names_dict" USING gin ("localized_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pokemon_names_english_trgm_idx" ON "pokemon_names_dict" USING gin ("english_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pokemon_sets_search_trgm_idx" ON "pokemon_sets_dict" USING gin ("search_text" gin_trgm_ops);
