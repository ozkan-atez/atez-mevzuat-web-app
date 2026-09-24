-- AlterTable
ALTER TABLE "ReportDraft" ADD COLUMN     "analysisRevisionId" TEXT;

-- AddForeignKey
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_analysisRevisionId_fkey" FOREIGN KEY ("analysisRevisionId") REFERENCES "AnalysisRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

