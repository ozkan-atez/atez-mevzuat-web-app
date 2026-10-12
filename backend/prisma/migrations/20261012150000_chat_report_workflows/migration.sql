-- AlterTable
ALTER TABLE "ReportRevision" ADD COLUMN     "baseVersion" INTEGER,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "createdByName" TEXT;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'WEB',
ADD COLUMN     "lastTestAt" TIMESTAMP(3),
ADD COLUMN     "lastTestResult" TEXT,
ADD COLUMN     "setupRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "setupStatus" TEXT NOT NULL DEFAULT 'READY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "context" JSONB;

-- AlterTable
ALTER TABLE "GeneralChatMessage" ADD COLUMN     "context" JSONB,
ADD COLUMN     "requestKey" TEXT;

-- AlterTable
ALTER TABLE "ReportDraft" ADD COLUMN     "restoredFromVersion" INTEGER,
ADD COLUMN     "revisionCounter" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReportFieldEdit" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "actorName" TEXT,
ADD COLUMN     "baseVersion" INTEGER,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "requestedBy" TEXT;

-- AlterTable
ALTER TABLE "ReportTemplate" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ManagedSource" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "SourceProfile" ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "ReportConversation" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdByName" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "requestKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "proposal" JSONB,
    "baseVersion" INTEGER,
    "draftRevision" INTEGER,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "appliedPaths" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "actorUserId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "sessionId" TEXT,
    "messageId" TEXT,
    "reportId" TEXT,
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSetupJob" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "initiatorUserId" TEXT,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SETUP',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "dispatchedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceSetupJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "sourceId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("sourceId","documentVersionId")
);

-- CreateTable
CREATE TABLE "SourceTemplateBinding" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SUPPORTING',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "instruction" TEXT NOT NULL DEFAULT '',
    "datePolicy" TEXT NOT NULL DEFAULT 'PUBLISHED_DATE',

    CONSTRAINT "SourceTemplateBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportConversation_reportId_updatedAt_idx" ON "ReportConversation"("reportId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportConversationMessage_requestKey_key" ON "ReportConversationMessage"("requestKey");

-- CreateIndex
CREATE INDEX "ReportConversationMessage_conversationId_createdAt_id_idx" ON "ReportConversationMessage"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageEvent_callId_key" ON "AiUsageEvent"("callId");

-- CreateIndex
CREATE INDEX "AiUsageEvent_workspaceId_actorUserId_createdAt_idx" ON "AiUsageEvent"("workspaceId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_category_createdAt_idx" ON "AiUsageEvent"("category", "createdAt");

-- CreateIndex
CREATE INDEX "SourceSetupJob_status_dispatchedAt_idx" ON "SourceSetupJob"("status", "dispatchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSetupJob_sourceId_revision_kind_key" ON "SourceSetupJob"("sourceId", "revision", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SourceTemplateBinding_sourceId_templateId_sectionId_key" ON "SourceTemplateBinding"("sourceId", "templateId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSuggestion_requestKey_key" ON "TemplateSuggestion"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "GeneralChatMessage_requestKey_key" ON "GeneralChatMessage"("requestKey");

-- AddForeignKey
ALTER TABLE "ReportConversation" ADD CONSTRAINT "ReportConversation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TopicReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportConversationMessage" ADD CONSTRAINT "ReportConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ReportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSetupJob" ADD CONSTRAINT "SourceSetupJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceTemplateBinding" ADD CONSTRAINT "SourceTemplateBinding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceTemplateBinding" ADD CONSTRAINT "SourceTemplateBinding_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Apply once in the same deployment migration which creates AiUsageEvent.
-- Only historical rows existing at migration time are imported; new structured
-- calls use meteredAiModel. Never query the legacy sums alongside the ledger.
INSERT INTO "AiUsageEvent" ("id","callId","workspaceId","actorUserId","provider","model","category","status","inputTokens","outputTokens","totalTokens","createdAt","updatedAt")
SELECT 'legacy-ai-'||c.id,'legacy-ai-'||c.id,r."workspaceId",r."initiatorUserId",'gemini',j.model,'SCAN_ANALYSIS',CASE WHEN c.status::text='COMPLETED' THEN 'COMPLETED' WHEN c.status::text='RUNNING' THEN 'RUNNING' ELSE 'FAILED' END,c."inputTokens",c."outputTokens",CASE WHEN c."inputTokens" IS NOT NULL AND c."outputTokens" IS NOT NULL THEN c."inputTokens"+c."outputTokens" END,c."createdAt",c."createdAt"
FROM "AiCall" c JOIN "AiJob" j ON j.id=c."aiJobId" JOIN "ScanRun" r ON r.id=j."scanRunId" ON CONFLICT ("callId") DO NOTHING;
INSERT INTO "AiUsageEvent" ("id","callId","workspaceId","actorUserId","provider","model","category","status","inputTokens","outputTokens","totalTokens","createdAt","updatedAt")
SELECT 'legacy-topic-'||c.id,'legacy-topic-'||c.id,COALESCE(m."workspaceId",r."workspaceId"),COALESCE(m."initiatorUserId",r."initiatorUserId"),'gemini',c.model,CASE WHEN c."requestMessageId" IS NULL THEN 'SCAN_ANALYSIS' ELSE 'REPORT_REVISION' END,CASE WHEN c.status::text='COMPLETED' THEN 'COMPLETED' WHEN c.status::text='RUNNING' THEN 'RUNNING' ELSE 'FAILED' END,c."inputTokens",c."outputTokens",CASE WHEN c."inputTokens" IS NOT NULL AND c."outputTokens" IS NOT NULL THEN c."inputTokens"+c."outputTokens" END,c."createdAt",c."createdAt"
FROM "TopicAiExecution" c JOIN "TopicProcess" t ON t.id=c."topicId" JOIN "ScanRun" r ON r.id=t."scanRunId" LEFT JOIN "ChatMessage" m ON m.id=c."requestMessageId" ON CONFLICT ("callId") DO NOTHING;
INSERT INTO "AiUsageEvent" ("id","callId","workspaceId","actorUserId","provider","model","category","status","inputTokens","outputTokens","totalTokens","createdAt","updatedAt")
SELECT 'legacy-previous-'||c.id,'legacy-previous-'||c.id,r."workspaceId",r."initiatorUserId",'gemini',j.model,'SCAN_ANALYSIS',CASE WHEN c.status::text='COMPLETED' THEN 'COMPLETED' WHEN c.status::text='RUNNING' THEN 'RUNNING' ELSE 'FAILED' END,c."inputTokens",c."outputTokens",CASE WHEN c."inputTokens" IS NOT NULL AND c."outputTokens" IS NOT NULL THEN c."inputTokens"+c."outputTokens" END,c."createdAt",c."createdAt"
FROM "PreviousSourceCall" c JOIN "PreviousSourceJob" j ON j.id=c."jobId" JOIN "ScanRun" r ON r.id=j."scanRunId" ON CONFLICT ("callId") DO NOTHING;

-- Preserve legacy report threads without copying any private GeneralChatMessage.
-- Legacy IDs are stable and API treats legacy:* conversations as read-only.
INSERT INTO "ReportConversation" (
  "id", "reportId", "title", "createdBy", "createdByName", "createdAt", "updatedAt"
)
SELECT
  'legacy:' || thread."id", report."id",
  COALESCE(NULLIF(thread."title", ''), 'Önceki rapor sohbeti'),
  NULL, NULL,
  thread."createdAt", thread."updatedAt"
FROM "AnalysisThread" thread
JOIN "TopicReport" report ON report."topicId" = thread."topicId"
  OR (report."id" = thread."topicId" AND report."topicId" IS NULL AND report."card" = 'K6')
WHERE EXISTS (SELECT 1 FROM "ChatMessage" message WHERE message."threadId" = thread."id" AND message."role" IN ('USER', 'ASSISTANT'))
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ReportConversationMessage" (
  "id", "conversationId", "role", "content", "authorId", "authorName", "status", "createdAt"
)
SELECT message."id", conversation."id", message."role"::text, message."content",
  message."initiatorUserId", COALESCE(author."name", author."email"), 'COMPLETED', message."createdAt"
FROM "ChatMessage" message
JOIN "ReportConversation" conversation ON conversation."id" = 'legacy:' || message."threadId"
LEFT JOIN "User" author ON author."id" = message."initiatorUserId"
WHERE message."role" IN ('USER', 'ASSISTANT')
ON CONFLICT ("id") DO NOTHING;
