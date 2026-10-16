CREATE TABLE "ai_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"work_item_id" uuid,
	"step_key" text,
	"purpose" text NOT NULL,
	"tier" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"location" text,
	"prompt_version" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"error_kind" text,
	"error_message" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_tokens" integer,
	"thinking_tokens" integer,
	"latency_ms" integer NOT NULL,
	"cost_usd" numeric(12, 6),
	"response_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"canonical_key" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"published_on" date,
	"list_context" jsonb,
	"processing_state" text NOT NULL,
	"title_decision" text,
	"title_reason" text,
	"title_decided_by" text,
	"latest_version_id" uuid,
	"etag" text,
	"last_modified" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"role" text NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"mime" text NOT NULL,
	"encoding" text,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"page_range" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"decision" text NOT NULL,
	"doc_type" text,
	"official_number" text,
	"institution" text,
	"publication_date" date,
	"change_kind" text,
	"gtip_codes" text[] DEFAULT '{}' NOT NULL,
	"sectors" text[] DEFAULT '{}' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"confidence" real,
	"needs_prior" text,
	"object_key" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"manifest_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_observation" (
	"source_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"observed" jsonb NOT NULL,
	"observed_hash" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_observation_source_id_scope_key_pk" PRIMARY KEY("source_id","scope_key")
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_key" text NOT NULL,
	"recipe_version" integer NOT NULL,
	"recipe" jsonb NOT NULL,
	"mode" text NOT NULL,
	"force_nodes" jsonb,
	"input" jsonb NOT NULL,
	"actor" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"step_key" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"cached" integer DEFAULT 0 NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "step_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_key" text NOT NULL,
	"cache_key" text NOT NULL,
	"version" integer NOT NULL,
	"output" jsonb NOT NULL,
	"versions" jsonb NOT NULL,
	"work_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"step_key" text NOT NULL,
	"item_key" text NOT NULL,
	"parent_item_id" uuid,
	"input" jsonb NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"fence" integer DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"cache_key" text,
	"step_result_id" uuid,
	"output" jsonb,
	"error" jsonb,
	"routed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbox" (
	"consumer" text NOT NULL,
	"message_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_consumer_message_id_pk" PRIMARY KEY("consumer","message_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"exchange" text NOT NULL,
	"routing_key" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"headers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "outbox_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "document_file" ADD CONSTRAINT "document_file_document_version_id_document_version_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_profile" ADD CONSTRAINT "document_profile_document_version_id_document_version_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_run_idx" ON "ai_call" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_call_created_idx" ON "ai_call" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_source_key_uq" ON "document" USING btree ("source_id","canonical_key");--> statement-breakpoint
CREATE INDEX "document_published_idx" ON "document" USING btree ("source_id","published_on");--> statement-breakpoint
CREATE UNIQUE INDEX "document_file_uq" ON "document_file" USING btree ("document_version_id","role","label");--> statement-breakpoint
CREATE UNIQUE INDEX "document_profile_version_uq" ON "document_profile" USING btree ("document_version_id","version");--> statement-breakpoint
CREATE INDEX "document_profile_decision_idx" ON "document_profile" USING btree ("decision");--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_hash_uq" ON "document_version" USING btree ("document_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "run_step_run_node_uq" ON "run_step" USING btree ("run_id","node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_result_key_version_uq" ON "step_result" USING btree ("cache_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_run_node_key_uq" ON "work_item" USING btree ("run_id","node_id","item_key");--> statement-breakpoint
CREATE INDEX "work_item_lease_idx" ON "work_item" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "work_item_run_idx" ON "work_item" USING btree ("run_id","node_id","status");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("id") WHERE published_at IS NULL;