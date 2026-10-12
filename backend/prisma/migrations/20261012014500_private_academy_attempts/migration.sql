-- Academy progress is personal learning data, not a shared workspace best score.
-- Keep historical unknown ownership nullable. No login or role change implicitly claims old attempts;
-- an explicit reviewed legacy bootstrap may assign them separately with --assign-academy.
-- Drop the cross-user uniqueness rule and replace it with owner+workspace-scoped uniqueness.
-- Existing IDs, answers, scores and timestamps remain unchanged.
ALTER TABLE "AcademyAttempt" ADD COLUMN "ownerUserId" TEXT, ADD COLUMN "workspaceId" TEXT;
DROP INDEX "AcademyAttempt_lessonId_period_key";
CREATE UNIQUE INDEX "AcademyAttempt_workspaceId_ownerUserId_lessonId_period_key" ON "AcademyAttempt"("workspaceId","ownerUserId","lessonId","period");
CREATE INDEX "AcademyAttempt_workspaceId_ownerUserId_createdAt_idx" ON "AcademyAttempt"("workspaceId","ownerUserId","createdAt");
ALTER TABLE "AcademyAttempt" ADD CONSTRAINT "AcademyAttempt_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademyAttempt" ADD CONSTRAINT "AcademyAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
