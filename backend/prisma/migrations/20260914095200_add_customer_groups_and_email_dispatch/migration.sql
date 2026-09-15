-- CreateEnum
CREATE TYPE "EmailDispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SIMULATED');

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "emails" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDispatch" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "reportVersion" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "recipients" TEXT[],
    "groupIds" TEXT[],
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "attachmentName" TEXT,
    "status" "EmailDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_name_key" ON "CustomerGroup"("name");

-- CreateIndex
CREATE INDEX "CustomerGroup_isActive_name_idx" ON "CustomerGroup"("isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDispatch_requestKey_key" ON "EmailDispatch"("requestKey");

-- CreateIndex
CREATE INDEX "EmailDispatch_topicId_createdAt_idx" ON "EmailDispatch"("topicId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailDispatch" ADD CONSTRAINT "EmailDispatch_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TopicProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
