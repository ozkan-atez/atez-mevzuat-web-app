CREATE TABLE "AssistantOfficialDocument" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "text" TEXT,
    "note" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantOfficialDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantOfficialDocument_sourceUrl_key" ON "AssistantOfficialDocument"("sourceUrl");
