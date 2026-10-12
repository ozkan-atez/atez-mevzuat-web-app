ALTER TABLE "WorkspaceAutomation" ADD COLUMN "times" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::INTEGER[];
ALTER TABLE "SourceScanRun" ADD COLUMN "queueDispatchedAt" TIMESTAMP(3);
CREATE TABLE "BackgroundJob" (
  "id" TEXT PRIMARY KEY, "queue" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "leaseUntil" TIMESTAMP(3) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "BackgroundJob_status_leaseUntil_idx" ON "BackgroundJob"("status", "leaseUntil");

ALTER TABLE "WorkspaceAutomation" ADD COLUMN "scheduleVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SourceScanRun" ADD COLUMN "queueVersion" INTEGER NOT NULL DEFAULT 0;
