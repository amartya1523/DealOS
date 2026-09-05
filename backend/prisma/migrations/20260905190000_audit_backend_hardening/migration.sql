-- Add durable identities and transaction records required by the audit repair.
ALTER TYPE "ApprovalState" ADD VALUE IF NOT EXISTS 'WAITING' BEFORE 'PENDING';
ALTER TYPE "ApprovalState" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
CREATE TYPE "RevisionState" AS ENUM ('DRAFT', 'SUBMITTED', 'SENT', 'SUPERSEDED');
CREATE TYPE "ProposalKind" AS ENUM ('COMMENT', 'PROPOSAL');
CREATE TYPE "ProposalState" AS ENUM ('OPEN', 'ADOPTED', 'DECLINED');
CREATE TYPE "OrderState" AS ENUM ('CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");

-- Backfill one real customer for every existing quote. Customer logins whose old
-- textual identifier is a name prefix are linked to that customer.
INSERT INTO "Customer" ("id", "name", "tier")
SELECT md5(random()::text || clock_timestamp()::text || q."customer"), q."customer", max(q."customerTier")
FROM "Quote" q GROUP BY q."customer";

INSERT INTO "Customer" ("id", "name", "tier")
SELECT md5(random()::text || clock_timestamp()::text || u."customerId"), u."customerId", 'Bronze'
FROM "User" u
WHERE u."role" = 'CUSTOMER' AND u."customerId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Customer" c WHERE lower(c."name") LIKE lower(u."customerId") || '%')
ON CONFLICT ("name") DO NOTHING;

UPDATE "User" u SET "customerId" = (
  SELECT c."id" FROM "Customer" c
  WHERE lower(c."name") LIKE lower(u."customerId") || '%'
  ORDER BY length(c."name"), c."id" LIMIT 1
)
WHERE u."role" = 'CUSTOMER' AND u."customerId" IS NOT NULL;
UPDATE "User" SET "customerId" = NULL WHERE "role" <> 'CUSTOMER';
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscountPolicy"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Quote"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalsByCadence" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "currentRevisionId" TEXT;
UPDATE "Quote" q SET "customerId" = c."id" FROM "Customer" c WHERE c."name" = q."customer";
ALTER TABLE "Quote" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Quote_currentRevisionId_key" ON "Quote"("currentRevisionId");

CREATE TABLE "QuoteRevision" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "state" "RevisionState" NOT NULL DEFAULT 'DRAFT',
  "orderDiscount" DECIMAL(5,2) NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "taxTotal" DECIMAL(14,2) NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "margin" DECIMAL(14,2) NOT NULL,
  "riskScore" DECIMAL(8,2) NOT NULL,
  "totalsByCadence" JSONB NOT NULL,
  "linesSnapshot" JSONB NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "termsHash" TEXT NOT NULL,
  "submittedById" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuoteRevision_termsHash_key" ON "QuoteRevision"("termsHash");
CREATE INDEX "QuoteRevision_quoteId_state_idx" ON "QuoteRevision"("quoteId", "state");
CREATE UNIQUE INDEX "QuoteRevision_quoteId_revisionNumber_key" ON "QuoteRevision"("quoteId", "revisionNumber");
ALTER TABLE "QuoteRevision" ADD CONSTRAINT "QuoteRevision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "QuoteRevision" (
  "id", "quoteId", "revisionNumber", "state", "orderDiscount", "subtotal", "taxTotal",
  "total", "margin", "riskScore", "totalsByCadence", "linesSnapshot", "policySnapshot", "termsHash", "submittedById", "createdAt"
)
SELECT md5(random()::text || clock_timestamp()::text || q."id"), q."id", 1,
  CASE WHEN q."stage" = 'DRAFT' THEN 'DRAFT'::"RevisionState" ELSE 'SUBMITTED'::"RevisionState" END,
  q."orderDiscount", q."total", 0, q."total", q."margin", q."riskScore", '{}'::jsonb,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', l."id", 'productId', l."productId", 'quantity', l."quantity", 'unitPrice', l."unitPrice",
    'unitCost', l."unitCost", 'discount', l."discount", 'allowedDiscount', l."allowedDiscount"
  ) ORDER BY l."createdAt", l."id") FROM "QuoteLine" l WHERE l."quoteId" = q."id"), '[]'::jsonb),
  COALESCE((SELECT to_jsonb(p) - 'updatedAt' FROM "DiscountPolicy" p WHERE p."tier" = q."customerTier"), '{}'::jsonb),
  encode(sha256((q."id" || ':' || q."version" || ':' || q."updatedAt")::bytea), 'hex'), q."ownerId", q."createdAt"
FROM "Quote" q;
UPDATE "Quote" q SET "currentRevisionId" = r."id" FROM "QuoteRevision" r WHERE r."quoteId" = q."id";
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "QuoteRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "Approval_quoteId_sequence_key";
ALTER TABLE "Approval" ADD COLUMN "revisionId" TEXT, ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1;
UPDATE "Approval" a SET "revisionId" = q."currentRevisionId" FROM "Quote" q WHERE q."id" = a."quoteId";
ALTER TABLE "Approval" ALTER COLUMN "revisionId" SET NOT NULL;
CREATE UNIQUE INDEX "Approval_quoteId_cycle_sequence_key" ON "Approval"("quoteId", "cycle", "sequence");
CREATE INDEX "Approval_revisionId_state_idx" ON "Approval"("revisionId", "state");
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Negotiation"
  ADD COLUMN "revisionId" TEXT,
  ADD COLUMN "kind" "ProposalKind" NOT NULL DEFAULT 'COMMENT',
  ADD COLUMN "state" "ProposalState" NOT NULL DEFAULT 'OPEN';
UPDATE "Negotiation" n SET "revisionId" = q."currentRevisionId", "kind" = CASE WHEN n."counterDiscount" IS NULL THEN 'COMMENT'::"ProposalKind" ELSE 'PROPOSAL'::"ProposalKind" END FROM "Quote" q WHERE q."id" = n."quoteId";
ALTER TABLE "Negotiation" ALTER COLUMN "revisionId" SET NOT NULL;
ALTER TABLE "Negotiation" ADD CONSTRAINT "Negotiation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CustomerAcceptance" (
  "id" TEXT NOT NULL, "quoteId" TEXT NOT NULL, "revisionId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL, "acceptedById" TEXT NOT NULL, "termsHash" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerAcceptance_quoteId_key" ON "CustomerAcceptance"("quoteId");
CREATE UNIQUE INDEX "CustomerAcceptance_revisionId_key" ON "CustomerAcceptance"("revisionId");
ALTER TABLE "CustomerAcceptance" ADD CONSTRAINT "CustomerAcceptance_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAcceptance" ADD CONSTRAINT "CustomerAcceptance_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Order" (
  "id" TEXT NOT NULL, "number" TEXT NOT NULL, "quoteId" TEXT NOT NULL, "revisionId" TEXT NOT NULL,
  "acceptanceId" TEXT NOT NULL, "customerId" TEXT NOT NULL, "state" "OrderState" NOT NULL DEFAULT 'CONFIRMED',
  "currency" TEXT NOT NULL DEFAULT 'USD', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");
CREATE UNIQUE INDEX "Order_revisionId_key" ON "Order"("revisionId");
CREATE UNIQUE INDEX "Order_acceptanceId_key" ON "Order"("acceptanceId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_acceptanceId_fkey" FOREIGN KEY ("acceptanceId") REFERENCES "CustomerAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrderLine" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "quoteLineId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL, "snapshot" JSONB NOT NULL, "recurring" BOOLEAN NOT NULL, "cadence" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderLine_quoteLineId_key" ON "OrderLine"("quoteLineId");
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Fulfillment" ADD COLUMN "orderId" TEXT;
CREATE UNIQUE INDEX "Fulfillment_orderId_key" ON "Fulfillment"("orderId");
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Subscription" ADD COLUMN "customerId" TEXT, ADD COLUMN "quoteId" TEXT,
  ADD COLUMN "orderId" TEXT, ADD COLUMN "orderLineId" TEXT, ADD COLUMN "productId" TEXT;
UPDATE "Subscription" s SET "customerId" = c."id" FROM "Customer" c WHERE c."name" = s."customer";
CREATE UNIQUE INDEX "Subscription_orderLineId_key" ON "Subscription"("orderLineId");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD COLUMN "customerId" TEXT, ADD COLUMN "orderId" TEXT;
UPDATE "Invoice" i SET "customerId" = q."customerId" FROM "Quote" q WHERE q."id" = i."quoteId";
ALTER TABLE "Invoice" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

WITH duplicates AS (
  SELECT "id", row_number() OVER (PARTITION BY "invoiceId", "reference" ORDER BY "createdAt", "id") AS rn
  FROM "Payment"
)
UPDATE "Payment" p SET "reference" = p."reference" || '#legacy-' || p."id" FROM duplicates d WHERE d."id" = p."id" AND d.rn > 1;
CREATE UNIQUE INDEX "Payment_invoiceId_reference_key" ON "Payment"("invoiceId", "reference");

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL, "actorId" TEXT NOT NULL, "operation" TEXT NOT NULL, "resourceKey" TEXT NOT NULL,
  "key" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "responseStatus" INTEGER NOT NULL, "responseBody" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");
CREATE UNIQUE INDEX "IdempotencyRecord_actorId_operation_resourceKey_key_key" ON "IdempotencyRecord"("actorId", "operation", "resourceKey", "key");

ALTER TABLE "AuditEvent" ADD COLUMN "revisionId" TEXT, ADD COLUMN "requestId" TEXT;

-- Database boundary protections for stock and posted invoice totals.
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_nonnegative_check" CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_balance_check" CHECK ("amount" >= 0 AND "paidAmount" >= 0 AND "paidAmount" <= "amount");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_positive_check" CHECK ("amount" > 0);
