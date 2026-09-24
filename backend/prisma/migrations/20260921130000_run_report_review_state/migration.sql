CREATE TYPE "ReportReviewStatus" AS ENUM ('READY', 'PENDING_APPROVAL');

ALTER TABLE "TopicReport"
  ADD COLUMN "reviewStatus" "ReportReviewStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "pendingSpecJson" JSONB,
  ADD COLUMN "pendingBaseVersion" INTEGER;

ALTER TABLE "TopicReport"
  ADD CONSTRAINT "TopicReport_pending_review_consistency" CHECK (
    ("reviewStatus" = 'READY' AND "pendingSpecJson" IS NULL AND "pendingBaseVersion" IS NULL)
    OR
    ("reviewStatus" = 'PENDING_APPROVAL' AND "pendingSpecJson" IS NOT NULL AND "pendingBaseVersion" IS NOT NULL)
  );
