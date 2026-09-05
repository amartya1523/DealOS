CREATE TYPE "DirectoryJoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

CREATE TABLE "OrganizationProfile" (
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "shortDescription" TEXT,
    "category" TEXT,
    "isDiscoverable" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "OrganizationProfile_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "DirectoryJoinRequest" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "DirectoryJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ,
    "decisionReason" TEXT,
    "resultingCustomerId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DirectoryJoinRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DirectoryJoinRequest_lifecycle_check" CHECK (
      ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL AND "decisionReason" IS NULL AND "resultingCustomerId" IS NULL)
      OR ("status" = 'APPROVED' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL AND "resultingCustomerId" IS NOT NULL)
      OR ("status" = 'DECLINED' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL AND length(btrim("decisionReason")) >= 5 AND "resultingCustomerId" IS NULL)
    )
);

CREATE UNIQUE INDEX "DirectoryJoinRequest_resultingCustomerId_key" ON "DirectoryJoinRequest"("resultingCustomerId");
CREATE UNIQUE INDEX "DirectoryJoinRequest_organizationId_email_status_key" ON "DirectoryJoinRequest"("organizationId", "email", "status");
CREATE INDEX "DirectoryJoinRequest_organizationId_status_createdAt_idx" ON "DirectoryJoinRequest"("organizationId", "status", "createdAt");
CREATE INDEX "DirectoryJoinRequest_email_createdAt_idx" ON "DirectoryJoinRequest"("email", "createdAt");

ALTER TABLE "OrganizationProfile"
  ADD CONSTRAINT "OrganizationProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectoryJoinRequest"
  ADD CONSTRAINT "DirectoryJoinRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DirectoryJoinRequest"
  ADD CONSTRAINT "DirectoryJoinRequest_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DirectoryJoinRequest"
  ADD CONSTRAINT "DirectoryJoinRequest_resultingCustomerId_fkey"
  FOREIGN KEY ("resultingCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
