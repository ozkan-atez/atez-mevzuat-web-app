-- CreateEnum
CREATE TYPE "ScanTrigger" AS ENUM ('MANUAL', 'CRON');

-- CreateEnum
CREATE TYPE "ScanRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScanStage" AS ENUM ('DISCOVERING', 'DOWNLOADING_DOCUMENTS', 'DISCOVERING_ASSETS', 'DOWNLOADING_ASSETS', 'VALIDATING', 'WRITING_MANIFEST');

-- CreateEnum
CREATE TYPE "EditionType" AS ENUM ('MAIN', 'SUPPLEMENT');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "AssetRole" AS ENUM ('ATTACHMENT', 'IMAGE', 'STYLESHEET_ASSET', 'OTHER_SUPPORTED');

-- CreateEnum
CREATE TYPE "StageExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FetchAttemptStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "trigger" "ScanTrigger" NOT NULL DEFAULT 'MANUAL',
    "targetDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "status" "ScanRunStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStage" "ScanStage",
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "downloadedBytes" BIGINT NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "queueJobId" TEXT,
    "indexSourceUrl" TEXT,
    "indexObjectKey" TEXT,
    "indexSha256" TEXT,
    "manifestObjectKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanOutbox" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GazetteEdition" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "publicationDate" DATE NOT NULL,
    "type" "EditionType" NOT NULL,
    "supplementNo" INTEGER,
    "indexUrl" TEXT NOT NULL,
    "discoveryOrder" INTEGER NOT NULL,

    CONSTRAINT "GazetteEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectedDocument" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentType" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "publicationOrder" INTEGER NOT NULL,
    "storedObjectId" TEXT,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "CollectedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "versionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAsset" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "storedObjectId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "referenceText" TEXT,
    "role" "AssetRole" NOT NULL,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "DocumentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageExecution" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "stage" "ScanStage" NOT NULL,
    "status" "StageExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FetchAttempt" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "FetchAttemptStatus" NOT NULL,
    "httpStatus" INTEGER,
    "redirectUrl" TEXT,
    "byteSize" BIGINT,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FetchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authorityType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastScanned" TIMESTAMP(3),
    "cursor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedOn" DATE NOT NULL,
    "institution" TEXT,
    "regulationNum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "extractedText" TEXT,
    "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "errorDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScanRun_requestKey_key" ON "ScanRun"("requestKey");

-- CreateIndex
CREATE INDEX "ScanRun_targetDate_createdAt_idx" ON "ScanRun"("targetDate", "createdAt");

-- CreateIndex
CREATE INDEX "ScanRun_status_createdAt_idx" ON "ScanRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScanOutbox_scanRunId_key" ON "ScanOutbox"("scanRunId");

-- CreateIndex
CREATE INDEX "ScanOutbox_dispatchedAt_availableAt_idx" ON "ScanOutbox"("dispatchedAt", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "GazetteEdition_scanRunId_indexUrl_key" ON "GazetteEdition"("scanRunId", "indexUrl");

-- CreateIndex
CREATE UNIQUE INDEX "CollectedDocument_editionId_sourceUrl_key" ON "CollectedDocument"("editionId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "StoredObject_sha256_key" ON "StoredObject"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "StoredObject_objectKey_key" ON "StoredObject"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAsset_documentId_sourceUrl_key" ON "DocumentAsset"("documentId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "StageExecution_scanRunId_stage_key" ON "StageExecution"("scanRunId", "stage");

-- CreateIndex
CREATE INDEX "FetchAttempt_scanRunId_createdAt_idx" ON "FetchAttempt"("scanRunId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Document_canonicalUrl_key" ON "Document"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Document_sourceId_externalId_key" ON "Document"("sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_contentHash_key" ON "DocumentVersion"("documentId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "ScanOutbox" ADD CONSTRAINT "ScanOutbox_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GazetteEdition" ADD CONSTRAINT "GazetteEdition_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectedDocument" ADD CONSTRAINT "CollectedDocument_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "GazetteEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectedDocument" ADD CONSTRAINT "CollectedDocument_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAsset" ADD CONSTRAINT "DocumentAsset_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CollectedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAsset" ADD CONSTRAINT "DocumentAsset_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageExecution" ADD CONSTRAINT "StageExecution_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FetchAttempt" ADD CONSTRAINT "FetchAttempt_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
