ALTER TABLE "SourceScanDocument" ADD COLUMN "captureStatus" TEXT NOT NULL DEFAULT 'PENDING', ADD COLUMN "captureError" TEXT, ADD COLUMN "capturedFiles" JSONB;
