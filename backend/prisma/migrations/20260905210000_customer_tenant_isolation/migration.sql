-- Customer is introduced by the audit-hardening migration. Keep its tenant
-- backfill separate so the previously applied module-access migration remains
-- immutable and fresh databases have a deterministic dependency order.
ALTER TABLE "Customer" ADD COLUMN "organizationId" TEXT;

UPDATE "Customer"
SET "organizationId" = '00000000-0000-0000-0000-000000000001'
WHERE "organizationId" IS NULL;

ALTER TABLE "Customer" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
