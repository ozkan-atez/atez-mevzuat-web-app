-- A run can contain at most one report that is not attached to a topic.
-- Such a report is the K6 "değişiklik yok" publication.
CREATE UNIQUE INDEX "TopicReport_one_no_change_per_run"
ON "TopicReport"("scanRunId")
WHERE "topicId" IS NULL;
