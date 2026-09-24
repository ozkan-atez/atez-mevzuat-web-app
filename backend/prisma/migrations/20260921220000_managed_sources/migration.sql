CREATE TABLE "ManagedSource" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT,
    "contentText" TEXT,
    "contentType" TEXT,
    "fetchError" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "useInChat" BOOLEAN NOT NULL DEFAULT true,
    "useInRuns" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagedSource_url_key" ON "ManagedSource"("url");
CREATE INDEX "ManagedSource_isActive_useInChat_idx" ON "ManagedSource"("isActive", "useInChat");
CREATE INDEX "ManagedSource_isActive_useInRuns_idx" ON "ManagedSource"("isActive", "useInRuns");
