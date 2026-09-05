-- Merge-safe Platform Owner control plane, applied after the current main schema
-- and its customer tenant-isolation repair migrations.
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "OrganizationAccessRole" AS ENUM ('ORGANIZATION_ADMIN', 'ORGANIZATION_MEMBER', 'PORTAL_USER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

ALTER TABLE "Organization" ADD COLUMN "slug" TEXT;
ALTER TABLE "Organization" ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "Organization"
SET "slug" = trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')) || '-' || left(replace("id", '-', ''), 8)
WHERE "slug" IS NULL;
ALTER TABLE "Organization" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

ALTER TABLE "Session"
  ADD COLUMN "csrfHash" TEXT,
  ADD COLUMN "viewAsOrganizationId" TEXT,
  ADD COLUMN "viewAsUserId" TEXT,
  ADD COLUMN "viewAsStartedAt" TIMESTAMP(3);

CREATE TABLE "OrganizationMembership" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessRole" "OrganizationAccessRole" NOT NULL DEFAULT 'ORGANIZATION_MEMBER',
  "businessRole" "Role" NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationMembership_portal_role_check" CHECK ("accessRole" <> 'PORTAL_USER' OR "businessRole" = 'CUSTOMER'),
  CONSTRAINT "OrganizationMembership_admin_role_check" CHECK ("accessRole" <> 'ORGANIZATION_ADMIN' OR "businessRole" = 'ADMIN')
);

INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "accessRole", "businessRole", "status", "updatedAt")
SELECT gen_random_uuid()::text, "organizationId", "id",
  CASE WHEN "role" = 'ADMIN' THEN 'ORGANIZATION_ADMIN'::"OrganizationAccessRole"
       WHEN "role" = 'CUSTOMER' THEN 'PORTAL_USER'::"OrganizationAccessRole"
       ELSE 'ORGANIZATION_MEMBER'::"OrganizationAccessRole" END,
  "role", 'ACTIVE', CURRENT_TIMESTAMP
FROM "User" WHERE "organizationId" IS NOT NULL;

CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");
CREATE INDEX "OrganizationMembership_userId_status_idx" ON "OrganizationMembership"("userId", "status");
CREATE INDEX "OrganizationMembership_organizationId_status_idx" ON "OrganizationMembership"("organizationId", "status");
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

CREATE TABLE "OrganizationInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "accessRole" "OrganizationAccessRole" NOT NULL,
  "businessRole" "Role" NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash" TEXT NOT NULL,
  "invitedById" TEXT,
  "platformActorId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationInvitation_portal_role_check" CHECK ("accessRole" <> 'PORTAL_USER' OR "businessRole" = 'CUSTOMER'),
  CONSTRAINT "OrganizationInvitation_admin_role_check" CHECK ("accessRole" <> 'ORGANIZATION_ADMIN' OR "businessRole" = 'ADMIN'),
  CONSTRAINT "OrganizationInvitation_actor_check" CHECK (("invitedById" IS NOT NULL AND "platformActorId" IS NULL) OR ("invitedById" IS NULL AND "platformActorId" IS NOT NULL))
);
CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key" ON "OrganizationInvitation"("tokenHash");
CREATE INDEX "OrganizationInvitation_organizationId_status_createdAt_idx" ON "OrganizationInvitation"("organizationId", "status", "createdAt");
CREATE INDEX "OrganizationInvitation_email_status_idx" ON "OrganizationInvitation"("email", "status");
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PrivilegedAudit" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "platformActorId" TEXT,
  "simulatedUserId" TEXT,
  "organizationId" TEXT,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "affectedModel" TEXT NOT NULL,
  "recordId" TEXT,
  "beforeValues" JSONB,
  "afterValues" JSONB,
  "reason" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "result" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivilegedAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrivilegedAudit_actor_check" CHECK (("actorId" IS NOT NULL AND "platformActorId" IS NULL) OR ("actorId" IS NULL AND "platformActorId" IS NOT NULL))
);
CREATE INDEX "PrivilegedAudit_createdAt_idx" ON "PrivilegedAudit"("createdAt");
CREATE INDEX "PrivilegedAudit_organizationId_createdAt_idx" ON "PrivilegedAudit"("organizationId", "createdAt");
CREATE INDEX "PrivilegedAudit_actorId_createdAt_idx" ON "PrivilegedAudit"("actorId", "createdAt");
CREATE INDEX "PrivilegedAudit_platformActorId_createdAt_idx" ON "PrivilegedAudit"("platformActorId", "createdAt");
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_simulatedUserId_fkey" FOREIGN KEY ("simulatedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "Customer_name_key";
DROP INDEX "DiscountPolicy_tier_key";
DROP INDEX "Warehouse_name_key";
CREATE UNIQUE INDEX "Customer_organizationId_name_key" ON "Customer"("organizationId", "name");
CREATE UNIQUE INDEX "DiscountPolicy_organizationId_tier_key" ON "DiscountPolicy"("organizationId", "tier");
CREATE UNIQUE INDEX "Warehouse_organizationId_name_key" ON "Warehouse"("organizationId", "name");
