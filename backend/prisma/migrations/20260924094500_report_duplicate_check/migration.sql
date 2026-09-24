ALTER TABLE "ScanRun"
  ADD COLUMN "reportDuplicateStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reportDuplicateGroups" JSONB,
  ADD COLUMN "reportDuplicateError" TEXT;
