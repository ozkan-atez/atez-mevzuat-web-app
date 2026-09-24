ALTER TABLE "SourceEndpoint" ADD COLUMN "adapter" TEXT;

CREATE TABLE "SourceScanRun" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "targetDate" DATE NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
  "scheduleSlot" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "errorSummary" TEXT,
  "reportHtml" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceScanRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceScanRun_requestKey_key" ON "SourceScanRun"("requestKey");
CREATE INDEX "SourceScanRun_targetDate_createdAt_idx" ON "SourceScanRun"("targetDate", "createdAt");
CREATE INDEX "SourceScanRun_status_createdAt_idx" ON "SourceScanRun"("status", "createdAt");
ALTER TABLE "SourceScanRun" ADD CONSTRAINT "SourceScanRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SourceScanDocument" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "publishedOn" DATE NOT NULL,
  "contentText" TEXT,
  "contentHash" TEXT,
  "feedUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceScanDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceScanDocument_runId_url_key" ON "SourceScanDocument"("runId", "url");
ALTER TABLE "SourceScanDocument" ADD CONSTRAINT "SourceScanDocument_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SourceScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "SourceEndpoint" ("id", "sourceId", "url", "title", "reason", "status", "adapter", "discoveredAt", "updatedAt")
SELECT 'fea00000-0000-4000-8000-000000000001', s.id, 'https://ggm.ticaret.gov.tr/duyurular', 'Gümrükler Genel Müdürlüğü duyuruları', 'Doğrulanmış tarihli duyuru akışı', 'ACTIVE', 'TICARET_DUYURULAR', NOW(), NOW()
FROM "Source" s WHERE s.key = 'ticaret-bakanligi'
ON CONFLICT ("sourceId", "url") DO UPDATE SET "adapter" = EXCLUDED."adapter", "status" = 'ACTIVE';

INSERT INTO "SourceEndpoint" ("id", "sourceId", "url", "title", "reason", "status", "adapter", "discoveredAt", "updatedAt")
SELECT 'fea00000-0000-4000-8000-000000000002', s.id, 'https://ticaret.gov.tr/gumruk-islemleri/mevzuat/genelge/2026', 'Gümrük genelgeleri', 'Yıl bazlı genelge listesi', 'ACTIVE', 'TICARET_GENELGE', NOW(), NOW()
FROM "Source" s WHERE s.key = 'ticaret-bakanligi'
ON CONFLICT ("sourceId", "url") DO UPDATE SET "adapter" = EXCLUDED."adapter", "status" = 'ACTIVE';

INSERT INTO "SourceEndpoint" ("id", "sourceId", "url", "title", "reason", "status", "adapter", "discoveredAt", "updatedAt")
SELECT 'fea00000-0000-4000-8000-000000000003', s.id, 'https://www.igmd.org.tr/mevzuat_haberleri', 'İGMD mevzuat haberleri', 'Tarihli mevzuat akışı', 'ACTIVE', 'IGMD_MEVZUAT', NOW(), NOW()
FROM "Source" s WHERE s.key = 'igmd'
ON CONFLICT ("sourceId", "url") DO UPDATE SET "adapter" = EXCLUDED."adapter", "status" = 'ACTIVE';

INSERT INTO "SourceEndpoint" ("id", "sourceId", "url", "title", "reason", "status", "adapter", "discoveredAt", "updatedAt")
SELECT 'fea00000-0000-4000-8000-000000000004', s.id, 'https://www.mevzuat.net/Guncellik.aspx', 'Mevzuat.Net güncellik', 'Son 30 mevzuat kaydı', 'ACTIVE', 'MEVZUAT_GUNCELLIK', NOW(), NOW()
FROM "Source" s WHERE s.key = 'mevzuat-net'
ON CONFLICT ("sourceId", "url") DO UPDATE SET "adapter" = EXCLUDED."adapter", "status" = 'ACTIVE';

INSERT INTO "SourceEndpoint" ("id", "sourceId", "url", "title", "reason", "status", "adapter", "discoveredAt", "updatedAt")
SELECT 'fea00000-0000-4000-8000-000000000005', s.id, 'https://tariff.singlewindow.io/legislation-news', 'TARIFF mevzuat duyuruları', 'Kimlik doğrulamalı veri akışı', 'ACTIVE', 'TARIFF_API', NOW(), NOW()
FROM "Source" s WHERE s.key = 'tariff'
ON CONFLICT ("sourceId", "url") DO UPDATE SET "adapter" = EXCLUDED."adapter", "status" = 'ACTIVE';
