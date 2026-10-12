-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "actorScope" TEXT NOT NULL DEFAULT 'local-workspace',
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'SOURCE',
ALTER COLUMN "sourceId" DROP NOT NULL,
ALTER COLUMN "canonicalUrl" DROP NOT NULL,
ALTER COLUMN "publishedOn" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "extractionMetadata" JSONB,
ADD COLUMN     "extractorVersion" TEXT,
ADD COLUMN     "fetchedAt" TIMESTAMP(3),
ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "storedObjectId" TEXT,
ADD COLUMN     "textObjectKey" TEXT;

-- Preserve unknown historical acquisition dates; only new versions get a default.
ALTER TABLE "DocumentVersion" ALTER COLUMN "fetchedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "GeneralChatMessage" ADD COLUMN     "documentVersionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "operationRequestIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "DocumentImport" (
    "id" TEXT NOT NULL,
    "actorScope" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documentVersionId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationRequest" (
    "id" TEXT NOT NULL,
    "actorScope" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationTask" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorScope" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputSignature" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "dependencyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "reused" BOOLEAN NOT NULL DEFAULT false,
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attemptNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationAttempt" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "leaseOwner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "providerRequestId" TEXT,

    CONSTRAINT "OperationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationArtifact" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "referenceId" TEXT,
    "objectKey" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationOutbox" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" TEXT NOT NULL,
    "actorScope" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "sessionId" TEXT,
    "messageId" TEXT,
    "scanRunId" TEXT,
    "sourceRunId" TEXT,
    "topicId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ATTACHMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCoverage" (
    "id" TEXT NOT NULL,
    "actorScope" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetDate" DATE NOT NULL,
    "profileVersion" TEXT NOT NULL,
    "datePolicy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "visitedPages" JSONB NOT NULL,
    "missingPages" JSONB NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentImport_actorScope_createdAt_idx" ON "DocumentImport"("actorScope", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentImport_actorScope_idempotencyKey_key" ON "DocumentImport"("actorScope", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OperationRequest_actorScope_createdAt_idx" ON "OperationRequest"("actorScope", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperationRequest_actorScope_idempotencyKey_key" ON "OperationRequest"("actorScope", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OperationTask_actorScope_inputSignature_status_idx" ON "OperationTask"("actorScope", "inputSignature", "status");

-- CreateIndex
CREATE INDEX "OperationTask_status_leaseUntil_idx" ON "OperationTask"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "OperationAttempt_taskId_number_key" ON "OperationAttempt"("taskId", "number");

-- CreateIndex
CREATE INDEX "OperationArtifact_taskId_idx" ON "OperationArtifact"("taskId");

-- CreateIndex
CREATE INDEX "OperationOutbox_status_availableAt_idx" ON "OperationOutbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "DocumentLink_actorScope_sessionId_idx" ON "DocumentLink"("actorScope", "sessionId");

-- CreateIndex
CREATE INDEX "SourceCoverage_actorScope_sourceId_targetDate_idx" ON "SourceCoverage"("actorScope", "sourceId", "targetDate");

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentImport" ADD CONSTRAINT "DocumentImport_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationTask" ADD CONSTRAINT "OperationTask_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "OperationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationAttempt" ADD CONSTRAINT "OperationAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OperationTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationArtifact" ADD CONSTRAINT "OperationArtifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OperationTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationOutbox" ADD CONSTRAINT "OperationOutbox_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OperationTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

