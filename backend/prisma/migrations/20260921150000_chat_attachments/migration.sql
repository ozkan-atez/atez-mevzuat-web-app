CREATE TABLE "GeneralChatAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneralChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeneralChatAttachment_messageId_key" ON "GeneralChatAttachment"("messageId");

ALTER TABLE "GeneralChatAttachment" ADD CONSTRAINT "GeneralChatAttachment_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "GeneralChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
