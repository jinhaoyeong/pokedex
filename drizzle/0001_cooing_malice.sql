CREATE TABLE "binder_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"card_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"clerk_id" text PRIMARY KEY NOT NULL,
	"preferred_currency" text DEFAULT 'MYR' NOT NULL,
	"layout_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "binder_cards" ADD CONSTRAINT "binder_cards_clerk_id_users_clerk_user_id_fk" FOREIGN KEY ("clerk_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_clerk_id_users_clerk_user_id_fk" FOREIGN KEY ("clerk_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "binder_cards_clerk_card_unique" ON "binder_cards" USING btree ("clerk_id","card_id");--> statement-breakpoint
CREATE INDEX "binder_cards_clerk_id_idx" ON "binder_cards" USING btree ("clerk_id");