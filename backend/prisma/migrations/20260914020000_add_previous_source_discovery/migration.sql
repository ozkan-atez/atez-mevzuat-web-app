ALTER TYPE "ScanStage" ADD VALUE 'DISCOVERING_PREVIOUS_SOURCES' AFTER 'VALIDATING';
ALTER TYPE "ScanCommandType" ADD VALUE 'RETRY_PREVIOUS_SOURCES';

CREATE TYPE "PreviousSourceJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'AWAITING_RETRY', 'FAILED');
CREATE TYPE "PreviousSourceOutcome" AS ENUM ('NOT_REQUIRED', 'VERIFIED', 'NOT_FOUND', 'AMBIGUOUS');
CREATE TYPE "PreviousSourceRelationship" AS ENUM ('AMENDS', 'REPEALS', 'EXTENDS', 'IMPLEMENTS', 'NONE');

CREATE TABLE "PreviousSourceJob" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "PreviousSourceJobStatus" NOT NULL DEFAULT 'QUEUED',
    "outcome" "PreviousSourceOutcome",
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "configurationHash" CHAR(64) NOT NULL,
    "needsPreviousSource" BOOLEAN,
    "relationship" "PreviousSourceRelationship",
    "targetRegulationTitle" TEXT,
    "targetRegulationIdentifier" TEXT,
    "targetRegulationType" TEXT,
    "targetInstitution" TEXT,
    "targetArticleReferences" JSONB,
    "queryCandidates" JSONB,
    "reason" TEXT,
    "lastErrorCategory" "AiErrorCategory",
    "lastErrorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PreviousSourceJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreviousSourceCall" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
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
    CONSTRAINT "PreviousSourceCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreviousSourceCandidate" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publicationDate" DATE NOT NULL,
    "gazetteNo" TEXT,
    "mukerrer" TEXT,
    "url" TEXT NOT NULL,
    "documentUrl" TEXT,
    "regulationType" TEXT,
    "exactIdentifierMatch" BOOLEAN NOT NULL DEFAULT false,
    "titleScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PreviousSourceCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreviousSourceDocument" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publicationDate" DATE NOT NULL,
    "gazetteNo" TEXT,
    "mukerrer" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "storedObjectId" TEXT NOT NULL,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PreviousSourceDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreviousSourceAsset" (
    "id" TEXT NOT NULL,
    "previousSourceId" TEXT NOT NULL,
    "storedObjectId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "referenceText" TEXT,
    "role" "AssetRole" NOT NULL,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PreviousSourceAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreviousSourceJob_documentId_key" ON "PreviousSourceJob"("documentId");
CREATE INDEX "PreviousSourceJob_scanRunId_status_idx" ON "PreviousSourceJob"("scanRunId", "status");
CREATE UNIQUE INDEX "PreviousSourceCall_jobId_attemptNo_key" ON "PreviousSourceCall"("jobId", "attemptNo");
CREATE INDEX "PreviousSourceCall_jobId_createdAt_idx" ON "PreviousSourceCall"("jobId", "createdAt");
CREATE UNIQUE INDEX "PreviousSourceCandidate_jobId_url_key" ON "PreviousSourceCandidate"("jobId", "url");
CREATE INDEX "PreviousSourceCandidate_jobId_score_idx" ON "PreviousSourceCandidate"("jobId", "score");
CREATE UNIQUE INDEX "PreviousSourceDocument_jobId_key" ON "PreviousSourceDocument"("jobId");
CREATE UNIQUE INDEX "PreviousSourceAsset_previousSourceId_sourceUrl_key" ON "PreviousSourceAsset"("previousSourceId", "sourceUrl");

ALTER TABLE "PreviousSourceJob" ADD CONSTRAINT "PreviousSourceJob_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreviousSourceJob" ADD CONSTRAINT "PreviousSourceJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CollectedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreviousSourceCall" ADD CONSTRAINT "PreviousSourceCall_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PreviousSourceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreviousSourceCandidate" ADD CONSTRAINT "PreviousSourceCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PreviousSourceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreviousSourceDocument" ADD CONSTRAINT "PreviousSourceDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PreviousSourceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreviousSourceDocument" ADD CONSTRAINT "PreviousSourceDocument_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PreviousSourceAsset" ADD CONSTRAINT "PreviousSourceAsset_previousSourceId_fkey" FOREIGN KEY ("previousSourceId") REFERENCES "PreviousSourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreviousSourceAsset" ADD CONSTRAINT "PreviousSourceAsset_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
