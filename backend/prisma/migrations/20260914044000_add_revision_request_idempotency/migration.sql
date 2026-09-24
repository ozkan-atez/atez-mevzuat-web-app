ALTER TABLE "AnalysisRevision" ADD COLUMN "requestMessageId" TEXT;
ALTER TABLE "ReportRevision" ADD COLUMN "requestMessageId" TEXT;

CREATE UNIQUE INDEX "AnalysisRevision_requestMessageId_key" ON "AnalysisRevision"("requestMessageId");
CREATE UNIQUE INDEX "ReportRevision_requestMessageId_key" ON "ReportRevision"("requestMessageId");
