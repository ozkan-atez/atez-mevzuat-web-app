ALTER TABLE "ReportTemplate" ADD COLUMN "definition" JSONB;
CREATE TABLE "TemplateAiRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorScope" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "model" TEXT NOT NULL,
  "result" JSONB,
  "usage" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TemplateAiRequest_actorScope_requestKey_key" UNIQUE ("actorScope", "requestKey")
);
