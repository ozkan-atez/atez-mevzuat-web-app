ALTER TABLE "ChatSession" ALTER COLUMN "ownerId" DROP NOT NULL;

CREATE TYPE "GeneralChatRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "GeneralChatMessageStatus" AS ENUM ('COMPLETED', 'FAILED');

CREATE TABLE "GeneralChatMessage" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "role" "GeneralChatRole" NOT NULL,
  "content" TEXT NOT NULL,
  "status" "GeneralChatMessageStatus" NOT NULL DEFAULT 'COMPLETED',
  "errorDetail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneralChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeneralChatMessage_sessionId_createdAt_idx" ON "GeneralChatMessage"("sessionId", "createdAt");

ALTER TABLE "GeneralChatMessage" ADD CONSTRAINT "GeneralChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
