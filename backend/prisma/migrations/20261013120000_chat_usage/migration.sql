CREATE TABLE "ChatUsageEvent" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "workspaceId" TEXT, "actorUserId" TEXT,
 "conversationId" TEXT NOT NULL, "conversationType" TEXT NOT NULL,
 "messageId" TEXT NOT NULL, "provider" TEXT, "model" TEXT,
 "mode" TEXT NOT NULL, "status" TEXT NOT NULL,
 "inputTokens" INTEGER, "outputTokens" INTEGER, "totalTokens" INTEGER,
 "cachedTokens" INTEGER, "reasoningTokens" INTEGER,
 "startedAt" TIMESTAMP(3) NOT NULL, "completedAt" TIMESTAMP(3)
);
CREATE INDEX "ChatUsageEvent_workspaceId_actorUserId_startedAt_idx" ON "ChatUsageEvent"("workspaceId", "actorUserId", "startedAt");
CREATE INDEX "ChatUsageEvent_conversationType_conversationId_startedAt_idx" ON "ChatUsageEvent"("conversationType", "conversationId", "startedAt");
CREATE INDEX "ChatUsageEvent_messageId_idx" ON "ChatUsageEvent"("messageId");

ALTER TABLE "TopicAiExecution" ADD COLUMN "totalTokens" INTEGER, ADD COLUMN "cachedTokens" INTEGER, ADD COLUMN "reasoningTokens" INTEGER;
