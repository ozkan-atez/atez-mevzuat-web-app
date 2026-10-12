-- AlterTable
ALTER TABLE "OperationRequest" ADD COLUMN     "sourceRunId" TEXT;

-- AddForeignKey
ALTER TABLE "OperationRequest" ADD CONSTRAINT "OperationRequest_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "SourceScanRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

