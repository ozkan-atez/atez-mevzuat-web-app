ALTER TYPE "ScanRunStatus" ADD VALUE 'AWAITING_RETRY';
ALTER TYPE "ScanStage" ADD VALUE 'AI_FILTERING' AFTER 'DISCOVERING';
ALTER TYPE "StageExecutionStatus" ADD VALUE 'AWAITING_RETRY';

CREATE TYPE "FilterDecision" AS ENUM ('IN', 'OUT', 'MAYBE');
CREATE TYPE "FinalFilterDecision" AS ENUM ('IN', 'OUT');
CREATE TYPE "AiJobKind" AS ENUM ('DOCUMENT_FILTER');
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'AWAITING_RETRY', 'FAILED');
CREATE TYPE "AiCallPhase" AS ENUM ('TITLE', 'CONTENT');
CREATE TYPE "AiCallStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiErrorCategory" AS ENUM ('AUTHENTICATION', 'PERMISSION', 'QUOTA_EXCEEDED', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'INVALID_RESPONSE', 'CONTENT_REJECTED', 'UNKNOWN_PROVIDER_ERROR');
CREATE TYPE "ScanCommandType" AS ENUM ('START_SCAN', 'RETRY_AI_FILTER');

ALTER TABLE "ScanOutbox" ADD COLUMN "commandType" "ScanCommandType";
ALTER TABLE "ScanOutbox" ADD COLUMN "requestKey" TEXT;

UPDATE "ScanOutbox" AS outbox
SET "commandType" = 'START_SCAN',
    "requestKey" = run."requestKey"
FROM "ScanRun" AS run
WHERE run."id" = outbox."scanRunId";

ALTER TABLE "ScanOutbox" ALTER COLUMN "commandType" SET DEFAULT 'START_SCAN';
ALTER TABLE "ScanOutbox" ALTER COLUMN "commandType" SET NOT NULL;
ALTER TABLE "ScanOutbox" ALTER COLUMN "requestKey" SET NOT NULL;
DROP INDEX "ScanOutbox_scanRunId_key";
CREATE UNIQUE INDEX "ScanOutbox_requestKey_key" ON "ScanOutbox"("requestKey");
CREATE INDEX "ScanOutbox_scanRunId_createdAt_idx" ON "ScanOutbox"("scanRunId", "createdAt");

CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "kind" "AiJobKind" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT NOT NULL,
    "titlePromptVersion" TEXT NOT NULL,
    "contentPromptVersion" TEXT NOT NULL,
    "configurationHash" CHAR(64) NOT NULL,
    "lastErrorCategory" "AiErrorCategory",
    "lastErrorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "aiJobId" TEXT NOT NULL,
    "phase" "AiCallPhase" NOT NULL,
    "batchKey" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "AiCallStatus" NOT NULL DEFAULT 'RUNNING',
    "providerRequestId" TEXT,
    "inputHash" CHAR(64) NOT NULL,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "errorCategory" "AiErrorCategory",
    "providerStatus" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentFilterDecision" (
    "id" TEXT NOT NULL,
    "aiJobId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "titleDecision" "FilterDecision" NOT NULL,
    "titleReason" TEXT NOT NULL,
    "titleConfidence" DOUBLE PRECISION NOT NULL,
    "contentDecision" "FinalFilterDecision",
    "contentReason" TEXT,
    "contentConfidence" DOUBLE PRECISION,
    "finalDecision" "FinalFilterDecision",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentFilterDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiJob_scanRunId_kind_key" ON "AiJob"("scanRunId", "kind");
CREATE INDEX "AiJob_status_createdAt_idx" ON "AiJob"("status", "createdAt");
CREATE UNIQUE INDEX "AiCall_aiJobId_phase_batchKey_attemptNo_key" ON "AiCall"("aiJobId", "phase", "batchKey", "attemptNo");
CREATE INDEX "AiCall_aiJobId_createdAt_idx" ON "AiCall"("aiJobId", "createdAt");
CREATE UNIQUE INDEX "DocumentFilterDecision_aiJobId_documentId_key" ON "DocumentFilterDecision"("aiJobId", "documentId");
CREATE INDEX "DocumentFilterDecision_documentId_idx" ON "DocumentFilterDecision"("documentId");
CREATE INDEX "DocumentFilterDecision_aiJobId_finalDecision_idx" ON "DocumentFilterDecision"("aiJobId", "finalDecision");

ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentFilterDecision" ADD CONSTRAINT "DocumentFilterDecision_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentFilterDecision" ADD CONSTRAINT "DocumentFilterDecision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CollectedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
