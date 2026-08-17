CREATE TYPE "public"."portfolio_transaction_type" AS ENUM('buy', 'sell', 'adjustment');--> statement-breakpoint
CREATE TABLE "market_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_slug" text NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"price_usd" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"metadata" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_slug" text NOT NULL,
	"card_name" text,
	"set_name" text,
	"language" text,
	"grade" text DEFAULT 'Ungraded' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"portfolio_item_id" uuid NOT NULL,
	"type" "portfolio_transaction_type" NOT NULL,
	"quantity" integer NOT NULL,
	"price_per_unit_usd" numeric(12, 2),
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_slug" text NOT NULL,
	"grade" text DEFAULT 'Ungraded' NOT NULL,
	"price_usd" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"source" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_slug" text NOT NULL,
	"card_name" text,
	"target_price_usd" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_portfolio_item_id_portfolio_items_id_fk" FOREIGN KEY ("portfolio_item_id") REFERENCES "public"."portfolio_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_observations_card_observed_idx" ON "market_observations" USING btree ("card_slug","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_items_user_card_grade_unique" ON "portfolio_items" USING btree ("user_id","card_slug","grade");--> statement-breakpoint
CREATE INDEX "portfolio_items_user_id_idx" ON "portfolio_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolio_transactions_item_id_idx" ON "portfolio_transactions" USING btree ("portfolio_item_id");--> statement-breakpoint
CREATE INDEX "portfolio_transactions_user_id_idx" ON "portfolio_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_card_grade_captured_idx" ON "price_snapshots" USING btree ("card_slug","grade","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clerk_user_id_unique" ON "users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_user_card_unique" ON "watchlist_items" USING btree ("user_id","card_slug");