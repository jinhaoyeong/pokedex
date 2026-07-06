ALTER TABLE "binder_cards" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "binder_cards" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "binder_cards" ADD COLUMN "market_price" numeric(12, 2);
--> statement-breakpoint
UPDATE "binder_cards" SET "name" = "card_id" WHERE "name" IS NULL;--> statement-breakpoint
UPDATE "binder_cards" SET "image_url" = '/icon.svg' WHERE "image_url" IS NULL;--> statement-breakpoint
ALTER TABLE "binder_cards" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "binder_cards" ALTER COLUMN "image_url" SET NOT NULL;
