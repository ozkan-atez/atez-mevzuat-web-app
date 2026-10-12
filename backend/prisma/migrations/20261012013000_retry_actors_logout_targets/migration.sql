-- Persist explicit retry actors independently of the original job creator.
-- NULL historical/cron initiators remain unknown or service-owned, never inferred from login.

ALTER TABLE "ScanOutbox" ADD COLUMN "workspaceId" TEXT, ADD COLUMN "initiatorUserId" TEXT;
ALTER TABLE "ScanOutbox" ADD CONSTRAINT "ScanOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScanOutbox" ADD CONSTRAINT "ScanOutbox_initiatorUserId_fkey" FOREIGN KEY ("initiatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ScanOutbox_workspace_initiator_idx" ON "ScanOutbox"("workspaceId","initiatorUserId");

ALTER TABLE "TopicOutbox" ADD COLUMN "workspaceId" TEXT, ADD COLUMN "initiatorUserId" TEXT;
ALTER TABLE "TopicOutbox" ADD CONSTRAINT "TopicOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicOutbox" ADD CONSTRAINT "TopicOutbox_initiatorUserId_fkey" FOREIGN KEY ("initiatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "TopicOutbox_workspace_initiator_idx" ON "TopicOutbox"("workspaceId","initiatorUserId");

ALTER TABLE "SourceScanRun" ADD COLUMN "workspaceId" TEXT, ADD COLUMN "initiatorUserId" TEXT;
ALTER TABLE "SourceScanRun" ADD CONSTRAINT "SourceScanRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceScanRun" ADD CONSTRAINT "SourceScanRun_initiatorUserId_fkey" FOREIGN KEY ("initiatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "SourceScanRun_workspace_initiator_idx" ON "SourceScanRun"("workspaceId","initiatorUserId");

-- Retain verified backchannel target markers, not raw logout tokens. Callback/session creation
-- must check these markers under the same serialization boundary as durable logout, preventing
-- a late callback from resurrecting a revoked provider SID/subject. Old replay records stay unknown.
ALTER TABLE "LogoutReplay" ADD COLUMN "clientId" TEXT, ADD COLUMN "providerSid" TEXT, ADD COLUMN "subject" TEXT, ADD COLUMN "issuedAt" TIMESTAMP(3);
CREATE INDEX "LogoutReplay_issuer_sid_idx" ON "LogoutReplay"("issuer","providerSid");
CREATE INDEX "LogoutReplay_issuer_subject_idx" ON "LogoutReplay"("issuer","subject");
