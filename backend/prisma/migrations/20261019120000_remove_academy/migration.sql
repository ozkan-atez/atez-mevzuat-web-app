-- Remove the retired academy feature and its stored attempts.
DROP TABLE "AcademyAttempt";

UPDATE "WorkspaceMembership"
SET "permissions" = array_remove("permissions", 'academy.write')
WHERE 'academy.write' = ANY("permissions");
