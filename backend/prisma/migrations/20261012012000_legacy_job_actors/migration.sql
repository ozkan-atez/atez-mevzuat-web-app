-- Track authenticated initiators on accepted manual scan and report revision requests.
-- Historical jobs and cron records keep NULL initiators: their origin is unknown or an explicit service actor,
-- not whichever user happens to log in first. Worker authorization must recheck current membership before execution.
-- Additive migration preserves every existing request ID and queue reference.
ALTER TABLE "ScanRun" ADD COLUMN "workspaceId" TEXT, ADD COLUMN "initiatorUserId" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "workspaceId" TEXT, ADD COLUMN "initiatorUserId" TEXT;
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_initiatorUserId_fkey" FOREIGN KEY ("initiatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_initiatorUserId_fkey" FOREIGN KEY ("initiatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ScanRun_workspace_initiator_idx" ON "ScanRun"("workspaceId","initiatorUserId");
CREATE INDEX "ChatMessage_workspace_initiator_idx" ON "ChatMessage"("workspaceId","initiatorUserId");
