BEGIN;
-- Only recover authors from explicit message attribution, never from the draft owner.
UPDATE "ReportFieldEdit" edit
SET "actorId" = COALESCE(edit."actorId", message."initiatorUserId"),
    "requestedBy" = COALESCE(edit."requestedBy", message."initiatorUserId"),
    "actorName" = COALESCE(edit."actorName", author."name", author."email")
FROM "ChatMessage" message
LEFT JOIN "User" author ON author."id" = message."initiatorUserId"
WHERE edit."chatMessageId" = message."id" AND message."initiatorUserId" IS NOT NULL;

UPDATE "ReportFieldEdit" edit
SET "baseVersion" = COALESCE(edit."baseVersion", draft."baseVersion"),
    "conversationId" = COALESCE(edit."conversationId", 'report:' || report."id")
FROM "ReportDraft" draft
JOIN "TopicReport" report ON report."topicId" = draft."topicId" OR report."id" = draft."reportId"
WHERE edit."draftId" = draft."id";
COMMIT;
