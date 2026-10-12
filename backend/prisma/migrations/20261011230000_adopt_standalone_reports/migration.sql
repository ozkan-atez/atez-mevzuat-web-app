-- AlterTable
ALTER TABLE "TopicReport" ADD COLUMN     "actorScope" TEXT,
ADD COLUMN     "operationTaskId" TEXT,
ALTER COLUMN "scanRunId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ReportDraft" ADD COLUMN     "actorScope" TEXT,
ADD COLUMN     "operationTaskId" TEXT,
ALTER COLUMN "topicId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TopicReport_operationTaskId_key" ON "TopicReport"("operationTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportDraft_operationTaskId_key" ON "ReportDraft"("operationTaskId");

-- AddForeignKey
ALTER TABLE "TopicReport" ADD CONSTRAINT "TopicReport_operationTaskId_fkey" FOREIGN KEY ("operationTaskId") REFERENCES "OperationTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_operationTaskId_fkey" FOREIGN KEY ("operationTaskId") REFERENCES "OperationTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

