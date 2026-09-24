-- CreateEnum
CREATE TYPE "TopicProcessStatus" AS ENUM ('QUEUED', 'ANALYZING', 'ANALYZED', 'RENDERING', 'VALIDATING', 'COMPLETED', 'AWAITING_RETRY', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisRevisionStatus" AS ENUM ('PASS', 'PASS_NO_RELEVANT_CONTENT');

-- CreateEnum
CREATE TYPE "ReportRevisionStatus" AS ENUM ('GENERATED', 'VALIDATED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportCard" AS ENUM ('K1', 'K2', 'K3', 'K4', 'K5', 'K6');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('AUTOMATED_ANALYSIS', 'REVISION_REQUEST', 'REVISION_RESULT', 'ERROR');

-- CreateEnum
CREATE TYPE "RevisionKind" AS ENUM ('ANALYSIS', 'PUBLICATION');

-- CreateEnum
CREATE TYPE "TopicOutboxCommand" AS ENUM ('RETRY_ANALYSIS', 'REVISE_ANALYSIS', 'REVISE_PUBLICATION');

-- CreateEnum
CREATE TYPE "TopicAiExecutionKind" AS ENUM ('INITIAL_ANALYSIS', 'ANALYSIS_REVISION', 'PUBLICATION_REVISION');

-- CreateTable
CREATE TABLE "TopicProcess" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "TopicProcessStatus" NOT NULL DEFAULT 'QUEUED',
    "lastErrorCategory" "AiErrorCategory",
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceBundle" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "manifestObjectKey" TEXT,
    "sourceSignature" CHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisThread" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "kind" "ChatMessageKind" NOT NULL,
    "revisionKind" "RevisionKind",
    "requestKey" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRevision" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AnalysisRevisionStatus" NOT NULL,
    "analysisObjectKey" TEXT NOT NULL,
    "markdownObjectKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicReport" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "topicId" TEXT,
    "title" TEXT NOT NULL,
    "basename" TEXT NOT NULL,
    "card" "ReportCard" NOT NULL,
    "latestVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRevision" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "analysisRevisionId" TEXT,
    "version" INTEGER NOT NULL,
    "status" "ReportRevisionStatus" NOT NULL,
    "card" "ReportCard" NOT NULL,
    "specObjectKey" TEXT NOT NULL,
    "htmlObjectKey" TEXT NOT NULL,
    "validationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicAiExecution" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "analysisRevisionId" TEXT,
    "kind" "TopicAiExecutionKind" NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "AiCallStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
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

    CONSTRAINT "TopicAiExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicOutbox" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "command" "TopicOutboxCommand" NOT NULL,
    "requestKey" TEXT NOT NULL,
    "messageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopicProcess_documentId_key" ON "TopicProcess"("documentId");

-- CreateIndex
CREATE INDEX "TopicProcess_scanRunId_status_idx" ON "TopicProcess"("scanRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceBundle_topicId_key" ON "EvidenceBundle"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisThread_topicId_key" ON "AnalysisThread"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_requestKey_key" ON "ChatMessage"("requestKey");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRevision_analysisObjectKey_key" ON "AnalysisRevision"("analysisObjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRevision_markdownObjectKey_key" ON "AnalysisRevision"("markdownObjectKey");

-- CreateIndex
CREATE INDEX "AnalysisRevision_topicId_createdAt_idx" ON "AnalysisRevision"("topicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRevision_topicId_version_key" ON "AnalysisRevision"("topicId", "version");

-- CreateIndex
CREATE INDEX "TopicReport_scanRunId_createdAt_idx" ON "TopicReport"("scanRunId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TopicReport_topicId_key" ON "TopicReport"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRevision_specObjectKey_key" ON "ReportRevision"("specObjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRevision_htmlObjectKey_key" ON "ReportRevision"("htmlObjectKey");

-- CreateIndex
CREATE INDEX "ReportRevision_analysisRevisionId_idx" ON "ReportRevision"("analysisRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRevision_reportId_version_key" ON "ReportRevision"("reportId", "version");

-- CreateIndex
CREATE INDEX "TopicAiExecution_topicId_createdAt_idx" ON "TopicAiExecution"("topicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TopicAiExecution_topicId_kind_attemptNo_key" ON "TopicAiExecution"("topicId", "kind", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "TopicOutbox_requestKey_key" ON "TopicOutbox"("requestKey");

-- CreateIndex
CREATE INDEX "TopicOutbox_dispatchedAt_availableAt_idx" ON "TopicOutbox"("dispatchedAt", "availableAt");

-- CreateIndex
CREATE INDEX "TopicOutbox_topicId_createdAt_idx" ON "TopicOutbox"("topicId", "createdAt");

-- AddForeignKey
ALTER TABLE "TopicProcess" ADD CONSTRAINT "TopicProcess_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicProcess" ADD CONSTRAINT "TopicProcess_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CollectedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceBundle" ADD CONSTRAINT "EvidenceBundle_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisThread" ADD CONSTRAINT "AnalysisThread_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AnalysisThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRevision" ADD CONSTRAINT "AnalysisRevision_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicReport" ADD CONSTRAINT "TopicReport_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicReport" ADD CONSTRAINT "TopicReport_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRevision" ADD CONSTRAINT "ReportRevision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TopicReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRevision" ADD CONSTRAINT "ReportRevision_analysisRevisionId_fkey" FOREIGN KEY ("analysisRevisionId") REFERENCES "AnalysisRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicAiExecution" ADD CONSTRAINT "TopicAiExecution_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicAiExecution" ADD CONSTRAINT "TopicAiExecution_analysisRevisionId_fkey" FOREIGN KEY ("analysisRevisionId") REFERENCES "AnalysisRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicOutbox" ADD CONSTRAINT "TopicOutbox_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
