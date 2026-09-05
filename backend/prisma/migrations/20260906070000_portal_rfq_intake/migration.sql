ALTER TYPE "AlertKind" ADD VALUE IF NOT EXISTS 'PORTAL_REQUEST';

CREATE TYPE "RfqHandlingMode" AS ENUM ('LEAD_FIRST', 'DIRECT_DRAFT');
CREATE TYPE "PortalRequestStatus" AS ENUM ('NEW', 'PROCESSED', 'DISMISSED');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONVERTED', 'DISMISSED');

ALTER TABLE "Organization"
  ADD COLUMN "rfqHandlingMode" "RfqHandlingMode" NOT NULL DEFAULT 'LEAD_FIRST';

ALTER TABLE "QuoteRevision"
  ADD COLUMN "internalNote" TEXT;

ALTER TABLE "Alert"
  ADD COLUMN "resourceType" TEXT NOT NULL DEFAULT 'QUOTE',
  ADD COLUMN "recipientId" TEXT;

ALTER TABLE "Alert" ADD CONSTRAINT "Alert_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Alert_recipientId_resolved_createdAt_idx"
  ON "Alert"("recipientId", "resolved", "createdAt");

CREATE TABLE "PortalRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "submittedByUserId" TEXT NOT NULL,
  "requirementsText" TEXT NOT NULL,
  "preferredDeliveryDate" TIMESTAMP(3),
  "status" "PortalRequestStatus" NOT NULL DEFAULT 'NEW',
  "resultingLeadId" TEXT,
  "resultingQuotationId" TEXT,
  "processedAt" TIMESTAMP(3),
  "processedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PortalRequest_requirements_length_check"
    CHECK (char_length(btrim("requirementsText")) BETWEEN 5 AND 5000),
  CONSTRAINT "PortalRequest_processing_check" CHECK (
    ("status" = 'NEW' AND "processedAt" IS NULL) OR
    ("status" IN ('PROCESSED', 'DISMISSED') AND "processedAt" IS NOT NULL AND "processedById" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "PortalRequest_resultingLeadId_key" ON "PortalRequest"("resultingLeadId");
CREATE UNIQUE INDEX "PortalRequest_resultingQuotationId_key" ON "PortalRequest"("resultingQuotationId");
CREATE INDEX "PortalRequest_organizationId_customerId_createdAt_idx"
  ON "PortalRequest"("organizationId", "customerId", "createdAt");
CREATE INDEX "PortalRequest_submittedByUserId_createdAt_idx"
  ON "PortalRequest"("submittedByUserId", "createdAt");

ALTER TABLE "PortalRequest" ADD CONSTRAINT "PortalRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortalRequest" ADD CONSTRAINT "PortalRequest_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalRequest" ADD CONSTRAINT "PortalRequest_submittedByUserId_fkey"
  FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortalRequest" ADD CONSTRAINT "PortalRequest_resultingQuotationId_fkey"
  FOREIGN KEY ("resultingQuotationId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalRequest" ADD CONSTRAINT "PortalRequest_processedById_fkey"
  FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PortalRequestLine" (
  "id" TEXT NOT NULL,
  "portalRequestId" TEXT NOT NULL,
  "productId" TEXT,
  "freeTextDescription" TEXT,
  "quantity" DECIMAL(14,3),
  "degraded" BOOLEAN NOT NULL DEFAULT false,
  "degradedReason" TEXT,
  CONSTRAINT "PortalRequestLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PortalRequestLine_content_check" CHECK (
    "productId" IS NOT NULL OR char_length(btrim(COALESCE("freeTextDescription", ''))) > 0
  ),
  CONSTRAINT "PortalRequestLine_quantity_check" CHECK ("quantity" IS NULL OR "quantity" > 0),
  CONSTRAINT "PortalRequestLine_degradation_check" CHECK (
    ("degraded" = false AND "degradedReason" IS NULL) OR
    ("degraded" = true AND "degradedReason" IS NOT NULL)
  )
);

CREATE INDEX "PortalRequestLine_portalRequestId_idx" ON "PortalRequestLine"("portalRequestId");
CREATE INDEX "PortalRequestLine_productId_idx" ON "PortalRequestLine"("productId");
ALTER TABLE "PortalRequestLine" ADD CONSTRAINT "PortalRequestLine_portalRequestId_fkey"
  FOREIGN KEY ("portalRequestId") REFERENCES "PortalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalRequestLine" ADD CONSTRAINT "PortalRequestLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Lead" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "portalRequestId" TEXT NOT NULL,
  "assignedRepId" TEXT NOT NULL,
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
  "requirementsSummary" TEXT NOT NULL,
  "convertedQuotationId" TEXT,
  "dismissReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Lead_state_check" CHECK (
    ("status" = 'NEW' AND "convertedQuotationId" IS NULL AND "dismissReason" IS NULL) OR
    ("status" = 'CONVERTED' AND "convertedQuotationId" IS NOT NULL AND "dismissReason" IS NULL) OR
    ("status" = 'DISMISSED' AND "convertedQuotationId" IS NULL AND char_length(btrim(COALESCE("dismissReason", ''))) > 0)
  )
);

CREATE UNIQUE INDEX "Lead_portalRequestId_key" ON "Lead"("portalRequestId");
CREATE UNIQUE INDEX "Lead_convertedQuotationId_key" ON "Lead"("convertedQuotationId");
CREATE INDEX "Lead_organizationId_assignedRepId_status_createdAt_idx"
  ON "Lead"("organizationId", "assignedRepId", "status", "createdAt");
CREATE INDEX "Lead_customerId_status_idx" ON "Lead"("customerId", "status");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_portalRequestId_fkey"
  FOREIGN KEY ("portalRequestId") REFERENCES "PortalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedRepId_fkey"
  FOREIGN KEY ("assignedRepId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedQuotationId_fkey"
  FOREIGN KEY ("convertedQuotationId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortalRequest" ADD CONSTRAINT "PortalRequest_resultingLeadId_fkey"
  FOREIGN KEY ("resultingLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
