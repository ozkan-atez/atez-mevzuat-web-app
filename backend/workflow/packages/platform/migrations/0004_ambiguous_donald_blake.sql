ALTER TABLE "template" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_seed_key_unique" UNIQUE("seed_key");