-- Multi-organization control plane and protected platform-administrator group.
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "OrganizationAccessRole" AS ENUM ('ORGANIZATION_ADMIN', 'ORGANIZATION_MEMBER', 'PORTAL_USER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

INSERT INTO "Organization" ("id", "name", "slug", "status", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000001', 'DealOS Demo', 'dealos-demo', 'ACTIVE', CURRENT_TIMESTAMP);

ALTER TABLE "Session"
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

CREATE TABLE "PlatformGroupMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformGroupMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessRole" "OrganizationAccessRole" NOT NULL,
    "businessRole" "Role" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationInvitation_portal_role_check" CHECK ("accessRole" <> 'PORTAL_USER' OR "businessRole" = 'CUSTOMER'),
    CONSTRAINT "OrganizationInvitation_admin_role_check" CHECK ("accessRole" <> 'ORGANIZATION_ADMIN' OR "businessRole" = 'ADMIN')
);

CREATE TABLE "PrivilegedAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
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
    CONSTRAINT "PrivilegedAudit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "DiscountPolicy" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Warehouse" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Alert" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN "organizationId" TEXT;

UPDATE "Product" SET "organizationId" = '00000000-0000-4000-8000-000000000001';
UPDATE "DiscountPolicy" SET "organizationId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Quote" SET "organizationId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Warehouse" SET "organizationId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Subscription" SET "organizationId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Invoice" SET "organizationId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Alert" SET "organizationId" = '00000000-0000-4000-8000-000000000001';
UPDATE "AuditEvent" SET "organizationId" = '00000000-0000-4000-8000-000000000001';

ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "DiscountPolicy" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Quote" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Warehouse" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Subscription" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Alert" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "AuditEvent" ALTER COLUMN "organizationId" SET NOT NULL;

INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "accessRole", "businessRole", "status", "updatedAt")
SELECT gen_random_uuid()::text, '00000000-0000-4000-8000-000000000001', "id",
       CASE WHEN "role" = 'ADMIN' THEN 'ORGANIZATION_ADMIN'::"OrganizationAccessRole"
            WHEN "role" = 'CUSTOMER' THEN 'PORTAL_USER'::"OrganizationAccessRole"
            ELSE 'ORGANIZATION_MEMBER'::"OrganizationAccessRole" END,
       "role", 'ACTIVE', CURRENT_TIMESTAMP
FROM "User";

DROP INDEX "DiscountPolicy_tier_key";
DROP INDEX "Warehouse_name_key";

CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");
CREATE INDEX "OrganizationMembership_userId_status_idx" ON "OrganizationMembership"("userId", "status");
CREATE INDEX "OrganizationMembership_organizationId_status_idx" ON "OrganizationMembership"("organizationId", "status");
CREATE UNIQUE INDEX "PlatformGroupMembership_userId_key" ON "PlatformGroupMembership"("userId");
CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key" ON "OrganizationInvitation"("tokenHash");
CREATE INDEX "OrganizationInvitation_organizationId_status_createdAt_idx" ON "OrganizationInvitation"("organizationId", "status", "createdAt");
CREATE INDEX "OrganizationInvitation_email_status_idx" ON "OrganizationInvitation"("email", "status");
CREATE INDEX "Product_organizationId_active_idx" ON "Product"("organizationId", "active");
CREATE UNIQUE INDEX "DiscountPolicy_organizationId_tier_key" ON "DiscountPolicy"("organizationId", "tier");
CREATE INDEX "Quote_organizationId_updatedAt_idx" ON "Quote"("organizationId", "updatedAt");
CREATE UNIQUE INDEX "Warehouse_organizationId_name_key" ON "Warehouse"("organizationId", "name");
CREATE INDEX "Subscription_organizationId_state_idx" ON "Subscription"("organizationId", "state");
CREATE INDEX "Invoice_organizationId_createdAt_idx" ON "Invoice"("organizationId", "createdAt");
CREATE INDEX "Alert_organizationId_createdAt_idx" ON "Alert"("organizationId", "createdAt");
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");
CREATE INDEX "PrivilegedAudit_createdAt_idx" ON "PrivilegedAudit"("createdAt");
CREATE INDEX "PrivilegedAudit_organizationId_createdAt_idx" ON "PrivilegedAudit"("organizationId", "createdAt");
CREATE INDEX "PrivilegedAudit_actorId_createdAt_idx" ON "PrivilegedAudit"("actorId", "createdAt");

ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformGroupMembership" ADD CONSTRAINT "PlatformGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformGroupMembership" ADD CONSTRAINT "PlatformGroupMembership_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscountPolicy" ADD CONSTRAINT "DiscountPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_simulatedUserId_fkey" FOREIGN KEY ("simulatedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivilegedAudit" ADD CONSTRAINT "PrivilegedAudit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
