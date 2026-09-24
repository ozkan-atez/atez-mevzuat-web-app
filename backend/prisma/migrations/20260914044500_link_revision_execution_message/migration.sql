ALTER TABLE "TopicAiExecution" ADD COLUMN "requestMessageId" TEXT;
CREATE INDEX "TopicAiExecution_requestMessageId_createdAt_idx" ON "TopicAiExecution"("requestMessageId", "createdAt");
