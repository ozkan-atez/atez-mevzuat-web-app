ALTER TABLE "Source" ADD COLUMN "name" TEXT;

CREATE TABLE "SourceEndpoint" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "reason" TEXT,
  "keywords" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "managedSourceId" TEXT,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceEndpoint_url_key" ON "SourceEndpoint"("url");
CREATE INDEX "SourceEndpoint_sourceId_status_idx" ON "SourceEndpoint"("sourceId", "status");
ALTER TABLE "SourceEndpoint" ADD CONSTRAINT "SourceEndpoint_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ManagedSourceSnapshot" (
  "id" TEXT NOT NULL,
  "managedSourceId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "contentText" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedSourceSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManagedSourceSnapshot_managedSourceId_contentHash_key" ON "ManagedSourceSnapshot"("managedSourceId", "contentHash");
CREATE INDEX "ManagedSourceSnapshot_managedSourceId_fetchedAt_idx" ON "ManagedSourceSnapshot"("managedSourceId", "fetchedAt");
ALTER TABLE "ManagedSourceSnapshot" ADD CONSTRAINT "ManagedSourceSnapshot_managedSourceId_fkey" FOREIGN KEY ("managedSourceId") REFERENCES "ManagedSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Source" ("id", "key", "name", "baseUrl", "authorityType", "isActive", "createdAt", "updatedAt") VALUES
('fb15dca0-9221-4ab1-a38f-11980346d001', 'resmi-gazete', 'T.C. Resmî Gazete', 'https://www.resmigazete.gov.tr/fihrist', 'OFFICIAL', true, NOW(), NOW()),
('fb15dca0-9221-4ab1-a38f-11980346d002', 'ticaret-bakanligi', 'Ticaret Bakanlığı', 'https://ticaret.gov.tr/gumruk-islemleri/mevzuat', 'OFFICIAL', true, NOW(), NOW()),
('fb15dca0-9221-4ab1-a38f-11980346d003', 'igmd', 'İGMD', 'https://www.igmd.org.tr/', 'PROFESSIONAL', true, NOW(), NOW()),
('fb15dca0-9221-4ab1-a38f-11980346d004', 'mevzuat-net', 'Mevzuat.Net', 'https://www.mevzuat.net/', 'COMMERCIAL', true, NOW(), NOW()),
('fb15dca0-9221-4ab1-a38f-11980346d005', 'tariff', 'TARIFF', 'https://tariff.singlewindow.io/', 'COMMERCIAL', true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
