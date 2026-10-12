-- Add real identity/session storage and explicit workspace ownership without deleting historical records.
-- Existing ownerless resources remain LEGACY and inaccessible to authenticated users until an explicit,
-- dry-run-reviewed bootstrap maps them. No email/first-login association or automatic ADMIN grant occurs.
-- canonicalKey replaces global URL identity so distinct private owners can archive the same URL safely.
-- No token, membership, workspace or user is seeded by this migration; provisioning is a separate operation.
-- Rolling back application code must retain these tables and ownership fields; dropping them would lose access history.

-- DropIndex
DROP INDEX "Document_canonicalUrl_key";

-- AlterTable
ALTER TABLE "TopicReport" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "canonicalKey" TEXT,
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN "legacyOwnerId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ReportDraft" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "DocumentImport" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "OperationRequest" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "OperationTask" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "DocumentLink" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "SourceCoverage" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLoginAttempt" (
    "idHash" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLoginAttempt_pkey" PRIMARY KEY ("idHash")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "idHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "providerSid" TEXT,
    "csrfToken" TEXT NOT NULL,
    "encryptedTokens" TEXT,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "refreshOwner" TEXT,
    "refreshUntil" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("idHash")
);

-- CreateTable
CREATE TABLE "LogoutReplay" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "jtiHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogoutReplay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalIdentity_userId_idx" ON "ExternalIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_issuer_subject_key" ON "ExternalIdentity"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_key_key" ON "Workspace"("key");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "AuthLoginAttempt_expiresAt_idx" ON "AuthLoginAttempt"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_issuer_subject_idx" ON "AuthSession"("issuer", "subject");

-- CreateIndex
CREATE INDEX "AuthSession_issuer_providerSid_idx" ON "AuthSession"("issuer", "providerSid");

-- CreateIndex
CREATE INDEX "AuthSession_absoluteExpiresAt_idx" ON "AuthSession"("absoluteExpiresAt");

-- CreateIndex
CREATE INDEX "LogoutReplay_expiresAt_idx" ON "LogoutReplay"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LogoutReplay_issuer_jtiHash_key" ON "LogoutReplay"("issuer", "jtiHash");

-- CreateIndex
CREATE UNIQUE INDEX "Document_canonicalKey_key" ON "Document"("canonicalKey");

-- AddForeignKey
ALTER TABLE "TopicReport" ADD CONSTRAINT "TopicReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicReport" ADD CONSTRAINT "TopicReport_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Earlier ownerId values were unconstrained placeholders, not verified identities.
-- Keep them as audit metadata; unknown strings must not become ownership or block FK creation.
UPDATE "ChatSession" SET "legacyOwnerId"="ownerId", "ownerId"=NULL
WHERE "ownerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id="ChatSession"."ownerId");

ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentImport" ADD CONSTRAINT "DocumentImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentImport" ADD CONSTRAINT "DocumentImport_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationRequest" ADD CONSTRAINT "OperationRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationRequest" ADD CONSTRAINT "OperationRequest_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationTask" ADD CONSTRAINT "OperationTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationTask" ADD CONSTRAINT "OperationTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCoverage" ADD CONSTRAINT "SourceCoverage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCoverage" ADD CONSTRAINT "SourceCoverage_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "ExternalIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve the previous canonical document identity for legacy jobs only. New authenticated imports
-- use server-computed private/shared scope keys; legacy values are never authorized by themselves.
UPDATE "Document" SET "canonicalKey" = 'local-workspace:' || "canonicalUrl" WHERE "canonicalUrl" IS NOT NULL;

-- Scope consistency for Document; nullable LEGACY rows preserve unknown historical ownership.
CREATE INDEX "Document_workspace_owner_visibility_idx" ON "Document"("workspaceId","ownerUserId","visibility");
ALTER TABLE "Document" ADD CONSTRAINT "Document_visibility_check" CHECK ("visibility" IN ('LEGACY','PRIVATE','WORKSPACE'));
ALTER TABLE "Document" ADD CONSTRAINT "Document_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerUserId" IS NOT NULL));
ALTER TABLE "Document" ADD CONSTRAINT "Document_shared_workspace_check" CHECK ("visibility" <> 'WORKSPACE' OR "workspaceId" IS NOT NULL);

-- Scope consistency for DocumentImport; nullable LEGACY rows preserve unknown historical ownership.
CREATE INDEX "DocumentImport_workspace_owner_visibility_idx" ON "DocumentImport"("workspaceId","ownerUserId","visibility");
ALTER TABLE "DocumentImport" ADD CONSTRAINT "DocumentImport_visibility_check" CHECK ("visibility" IN ('LEGACY','PRIVATE','WORKSPACE'));
ALTER TABLE "DocumentImport" ADD CONSTRAINT "DocumentImport_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerUserId" IS NOT NULL));
ALTER TABLE "DocumentImport" ADD CONSTRAINT "DocumentImport_shared_workspace_check" CHECK ("visibility" <> 'WORKSPACE' OR "workspaceId" IS NOT NULL);

-- Scope consistency for DocumentLink; nullable LEGACY rows preserve unknown historical ownership.
CREATE INDEX "DocumentLink_workspace_owner_visibility_idx" ON "DocumentLink"("workspaceId","ownerUserId","visibility");
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_visibility_check" CHECK ("visibility" IN ('LEGACY','PRIVATE','WORKSPACE'));
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerUserId" IS NOT NULL));
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_shared_workspace_check" CHECK ("visibility" <> 'WORKSPACE' OR "workspaceId" IS NOT NULL);

-- Scope consistency for OperationRequest; nullable LEGACY rows preserve unknown historical ownership.
CREATE INDEX "OperationRequest_workspace_owner_visibility_idx" ON "OperationRequest"("workspaceId","ownerUserId","visibility");
ALTER TABLE "OperationRequest" ADD CONSTRAINT "OperationRequest_visibility_check" CHECK ("visibility" IN ('LEGACY','PRIVATE','WORKSPACE'));
ALTER TABLE "OperationRequest" ADD CONSTRAINT "OperationRequest_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerUserId" IS NOT NULL));
ALTER TABLE "OperationRequest" ADD CONSTRAINT "OperationRequest_shared_workspace_check" CHECK ("visibility" <> 'WORKSPACE' OR "workspaceId" IS NOT NULL);

-- Scope consistency for OperationTask; nullable LEGACY rows preserve unknown historical ownership.
CREATE INDEX "OperationTask_workspace_owner_visibility_idx" ON "OperationTask"("workspaceId","ownerUserId","visibility");
ALTER TABLE "OperationTask" ADD CONSTRAINT "OperationTask_visibility_check" CHECK ("visibility" IN ('LEGACY','PRIVATE','WORKSPACE'));
ALTER TABLE "OperationTask" ADD CONSTRAINT "OperationTask_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerUserId" IS NOT NULL));
ALTER TABLE "OperationTask" ADD CONSTRAINT "OperationTask_shared_workspace_check" CHECK ("visibility" <> 'WORKSPACE' OR "workspaceId" IS NOT NULL);

-- Scope consistency for SourceCoverage; nullable LEGACY rows preserve unknown historical ownership.
CREATE INDEX "SourceCoverage_workspace_owner_visibility_idx" ON "SourceCoverage"("workspaceId","ownerUserId","visibility");
ALTER TABLE "SourceCoverage" ADD CONSTRAINT "SourceCoverage_visibility_check" CHECK ("visibility" IN ('LEGACY','PRIVATE','WORKSPACE'));
ALTER TABLE "SourceCoverage" ADD CONSTRAINT "SourceCoverage_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerUserId" IS NOT NULL));
ALTER TABLE "SourceCoverage" ADD CONSTRAINT "SourceCoverage_shared_workspace_check" CHECK ("visibility" <> 'WORKSPACE' OR "workspaceId" IS NOT NULL);

-- Scope consistency for TopicReport; nullable LEGACY rows preserve unknown historical ownership.
CREATE INDEX "TopicReport_workspace_owner_visibility_idx" ON "TopicReport"("workspaceId","ownerUserId","visibility");
ALTER TABLE "TopicReport" ADD CONSTRAINT "TopicReport_visibility_check" CHECK ("visibility" IN ('LEGACY','PRIVATE','WORKSPACE'));
ALTER TABLE "TopicReport" ADD CONSTRAINT "TopicReport_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerUserId" IS NOT NULL));
ALTER TABLE "TopicReport" ADD CONSTRAINT "TopicReport_shared_workspace_check" CHECK ("visibility" <> 'WORKSPACE' OR "workspaceId" IS NOT NULL);

-- Scope consistency for ReportDraft; nullable LEGACY rows preserve unknown historical ownership.
CREATE INDEX "ReportDraft_workspace_owner_visibility_idx" ON "ReportDraft"("workspaceId","ownerUserId","visibility");
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_visibility_check" CHECK ("visibility" IN ('LEGACY','PRIVATE','WORKSPACE'));
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerUserId" IS NOT NULL));
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_shared_workspace_check" CHECK ("visibility" <> 'WORKSPACE' OR "workspaceId" IS NOT NULL);

CREATE INDEX "ChatSession_workspace_owner_visibility_idx" ON "ChatSession"("workspaceId","ownerId","visibility");
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_private_owner_check" CHECK ("visibility" <> 'PRIVATE' OR ("workspaceId" IS NOT NULL AND "ownerId" IS NOT NULL));
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_role_check" CHECK ("role" IN ('VIEWER','EDITOR','ADMIN'));
