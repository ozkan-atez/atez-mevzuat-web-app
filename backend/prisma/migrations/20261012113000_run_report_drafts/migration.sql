ALTER TABLE "ReportDraft" ADD COLUMN "reportId" TEXT;
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TopicReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ReportDraft_open_report_unique" ON "ReportDraft"("reportId") WHERE "status" = 'OPEN' AND "reportId" IS NOT NULL;
