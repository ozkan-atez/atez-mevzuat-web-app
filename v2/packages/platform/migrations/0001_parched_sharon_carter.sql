CREATE TABLE "analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"object_key" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_version_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"to_version_id" uuid,
	"to_tariff_snapshot_id" uuid,
	"strategy" text NOT NULL,
	"ambiguous" integer DEFAULT 0 NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtip_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid,
	"tariff_snapshot_id" uuid,
	"source" text NOT NULL,
	"table_title" text,
	"gtip" text NOT NULL,
	"description" text,
	"value" text,
	"raw_value" text,
	"unit" text,
	"currency" text,
	"origin" text,
	"page" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_token" (
	"account_key" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"card" text NOT NULL,
	"current_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"analysis_id" uuid NOT NULL,
	"spec_key" text NOT NULL,
	"html_key" text,
	"validation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolution_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"strategy" text NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariff_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gtip" text NOT NULL,
	"query_date" text NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"primary_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_member" (
	"topic_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"role" text NOT NULL,
	"matched_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_member_topic_id_document_version_id_pk" PRIMARY KEY("topic_id","document_version_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_topic_rev_uq" ON "analysis" USING btree ("topic_id","revision");--> statement-breakpoint
CREATE INDEX "document_relation_from_idx" ON "document_relation" USING btree ("from_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_relation_uq" ON "document_relation" USING btree ("from_version_id","relation","to_version_id","to_tariff_snapshot_id");--> statement-breakpoint
CREATE INDEX "gtip_value_dv_idx" ON "gtip_value" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "gtip_value_gtip_idx" ON "gtip_value" USING btree ("gtip");--> statement-breakpoint
CREATE UNIQUE INDEX "report_topic_uq" ON "report" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_revision_uq" ON "report_revision" USING btree ("report_id","revision");--> statement-breakpoint
CREATE INDEX "resolution_attempt_dv_idx" ON "resolution_attempt" USING btree ("document_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_snapshot_uq" ON "tariff_snapshot" USING btree ("gtip","query_date","sha256");--> statement-breakpoint
CREATE INDEX "tariff_snapshot_lookup_idx" ON "tariff_snapshot" USING btree ("gtip","query_date");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_member_dv_uq" ON "topic_member" USING btree ("document_version_id");