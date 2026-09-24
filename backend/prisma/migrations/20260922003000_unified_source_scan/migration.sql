ALTER TABLE "ScanRun" ADD COLUMN "sourceKeys" TEXT[] NOT NULL DEFAULT ARRAY['resmi-gazete']::TEXT[];
ALTER TABLE "SourceScanRun" ADD COLUMN "scanRunId" TEXT;
CREATE INDEX "SourceScanRun_scanRunId_idx" ON "SourceScanRun"("scanRunId");
ALTER TABLE "SourceScanRun" ADD CONSTRAINT "SourceScanRun_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
