-- CreateEnum
CREATE TYPE "ReportDraftStatus" AS ENUM ('OPEN', 'PUBLISHED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ReportEditSource" AS ENUM ('USER', 'AI');

-- AlterEnum
ALTER TYPE "RevisionKind" ADD VALUE 'DIRECT_EDIT';

-- AlterEnum
ALTER TYPE "TopicOutboxCommand" ADD VALUE 'REVISE_FIELDS';

-- AlterTable
ALTER TABLE "ReportRevision" ADD COLUMN     "draftId" TEXT;

-- CreateTable
CREATE TABLE "ReportDraft" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "specJson" JSONB NOT NULL,
    "status" "ReportDraftStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportFieldEdit" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "previousValue" JSONB,
    "nextValue" JSONB,
    "source" "ReportEditSource" NOT NULL,
    "prompt" TEXT,
    "chatMessageId" TEXT,
    "requestKey" TEXT,
    "revertsEditId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportFieldEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportDraft_topicId_createdAt_idx" ON "ReportDraft"("topicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportFieldEdit_requestKey_key" ON "ReportFieldEdit"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReportFieldEdit_revertsEditId_key" ON "ReportFieldEdit"("revertsEditId");

-- CreateIndex
CREATE INDEX "ReportFieldEdit_draftId_createdAt_idx" ON "ReportFieldEdit"("draftId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportFieldEdit_draftId_sequence_key" ON "ReportFieldEdit"("draftId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRevision_draftId_key" ON "ReportRevision"("draftId");

-- AddForeignKey
ALTER TABLE "ReportRevision" ADD CONSTRAINT "ReportRevision_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ReportDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportFieldEdit" ADD CONSTRAINT "ReportFieldEdit_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ReportDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportFieldEdit" ADD CONSTRAINT "ReportFieldEdit_revertsEditId_fkey" FOREIGN KEY ("revertsEditId") REFERENCES "ReportFieldEdit"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one open draft per report. Prisma cannot express a filtered unique
-- index, so the constraint is declared here; without it two concurrent editors
-- would each open their own draft and silently overwrite one another.
CREATE UNIQUE INDEX "ReportDraft_one_open_per_topic" ON "ReportDraft"("topicId") WHERE "status" = 'OPEN';
