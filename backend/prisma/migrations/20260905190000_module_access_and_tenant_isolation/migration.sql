ALTER TABLE "User" ADD COLUMN "loginId" TEXT;
ALTER TABLE "User" ADD COLUMN "googleSubject" TEXT;
ALTER TABLE "User" ADD COLUMN "moduleAccess" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");

INSERT INTO "Organization" ("id", "name", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'DealOS Demo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

UPDATE "User" SET "organizationId" = '00000000-0000-0000-0000-000000000001'
WHERE "organizationId" IS NULL;

ALTER TABLE "Product" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "DiscountPolicy" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Warehouse" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Alert" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN "organizationId" TEXT;

UPDATE "Product" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Customer" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
UPDATE "DiscountPolicy" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Quote" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Warehouse" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Subscription" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Invoice" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Alert" SET "organizationId" = '00000000-0000-0000-0000-000000000001';
UPDATE "AuditEvent" SET "organizationId" = '00000000-0000-0000-0000-000000000001';

ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "DiscountPolicy" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Quote" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Warehouse" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Subscription" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Alert" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "AuditEvent" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscountPolicy" ADD CONSTRAINT "DiscountPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "OrganizationInvite";
