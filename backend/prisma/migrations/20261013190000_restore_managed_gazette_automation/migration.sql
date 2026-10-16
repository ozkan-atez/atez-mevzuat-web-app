-- Restore the original Gazette cadence as one ordinary, editable automation.
-- This is a one-time data migration: deleting it later must not recreate it.
INSERT INTO "Source" ("id", "key", "name", "baseUrl", "authorityType", "updatedAt")
VALUES ('restored-gazette-source', 'resmi-gazete', 'Resmî Gazete', 'https://www.resmigazete.gov.tr', 'OFFICIAL', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "WorkspaceAutomation" (
  "id", "name", "hour", "minute", "times", "weekdays", "timezone", "isActive", "sourceIds", "groupIds", "updatedAt"
)
SELECT 'gazette-daily-automation', 'Resmî Gazete günlük taraması', 5, 0,
  ARRAY['05:00', '10:00', '15:00', '23:00'], ARRAY[1,2,3,4,5,6,7], 'Europe/Istanbul', true, ARRAY["id"], ARRAY[]::text[], CURRENT_TIMESTAMP
FROM "Source" WHERE "key" = 'resmi-gazete'
ON CONFLICT ("id") DO NOTHING;

-- Preserve old report/log identities and attach their history to the restored job.
UPDATE "ScanRun"
SET "automationId" = 'gazette-daily-automation',
    "workspaceConfig" = COALESCE(NULLIF("workspaceConfig", 'null'::jsonb), '{}'::jsonb)
      || jsonb_build_object('automationName', 'Resmî Gazete günlük taraması')
WHERE "automationId" IS NULL AND "trigger" = 'CRON'
  AND "scheduleSlot" IN ('ANA_SAYI', 'MUKERRER_1', 'MUKERRER_2', 'GUN_SONU');

UPDATE "WorkspaceAutomation" SET
  "lastRunId" = (SELECT "id" FROM "ScanRun" WHERE "automationId" = 'gazette-daily-automation' ORDER BY "createdAt" DESC, "id" DESC LIMIT 1),
  "lastRunAt" = (SELECT "createdAt" FROM "ScanRun" WHERE "automationId" = 'gazette-daily-automation' ORDER BY "createdAt" DESC, "id" DESC LIMIT 1)
WHERE "id" = 'gazette-daily-automation' AND "lastRunId" IS NULL;
