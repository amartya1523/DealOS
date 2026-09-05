-- Replace organization-user platform grants with an independent, environment-authenticated owner session.
CREATE TABLE "PlatformOwnerSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewAsOrganizationId" TEXT,
    "viewAsUserId" TEXT,
    "viewAsStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformOwnerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformOwnerSession_tokenHash_key" ON "PlatformOwnerSession"("tokenHash");
CREATE INDEX "PlatformOwnerSession_expiresAt_idx" ON "PlatformOwnerSession"("expiresAt");

ALTER TABLE "PrivilegedAudit" ALTER COLUMN "actorId" DROP NOT NULL;
ALTER TABLE "PrivilegedAudit" ADD COLUMN "platformActorId" TEXT;
CREATE INDEX "PrivilegedAudit_platformActorId_createdAt_idx" ON "PrivilegedAudit"("platformActorId", "createdAt");
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_actor_check"
  CHECK (("actorId" IS NOT NULL AND "platformActorId" IS NULL) OR ("actorId" IS NULL AND "platformActorId" IS NOT NULL));

DROP TABLE "PlatformGroupMembership";
