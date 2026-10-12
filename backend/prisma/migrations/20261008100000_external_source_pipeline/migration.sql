ALTER TYPE "EditionType" ADD VALUE IF NOT EXISTS 'EXTERNAL';
ALTER TABLE "CollectedDocument" ADD COLUMN "externalSourceDocumentId" TEXT, ADD COLUMN "sourceAuthority" TEXT, ADD COLUMN "sourceName" TEXT;
CREATE UNIQUE INDEX "CollectedDocument_externalSourceDocumentId_key" ON "CollectedDocument"("externalSourceDocumentId");
ALTER TABLE "SourceScanRun" ADD COLUMN "processingScanRunId" TEXT;
CREATE UNIQUE INDEX "SourceScanRun_processingScanRunId_key" ON "SourceScanRun"("processingScanRunId");
ALTER TABLE "SourceScanDocument" ADD COLUMN "filterDecision" TEXT, ADD COLUMN "filterReason" TEXT, ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'PENDING', ADD COLUMN "processingError" TEXT, ADD COLUMN "topicId" TEXT, ADD COLUMN "reportVersion" INTEGER;
