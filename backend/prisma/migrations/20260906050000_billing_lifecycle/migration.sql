CREATE TYPE "SubscriptionChangeKind" AS ENUM ('AMOUNT_CHANGED', 'PAUSED', 'RESUMED', 'CANCELLED');

ALTER TABLE "Subscription"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Invoice"
  ADD COLUMN "billingKey" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "Invoice" AS invoice
SET "currency" = COALESCE("Order"."currency", "Customer"."currency", 'INR')
FROM "Customer"
LEFT JOIN "Order" ON "Order"."customerId" = "Customer"."id"
WHERE invoice."customerId" = "Customer"."id"
  AND (invoice."orderId" IS NULL OR "Order"."id" = invoice."orderId");

CREATE UNIQUE INDEX "Invoice_billingKey_key" ON "Invoice"("billingKey");

CREATE TABLE "SubscriptionChange" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "kind" "SubscriptionChangeKind" NOT NULL,
  "previousAmount" DECIMAL(12,2),
  "newAmount" DECIMAL(12,2),
  "previousState" "SubscriptionState" NOT NULL,
  "newState" "SubscriptionState" NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubscriptionChange_subscriptionId_createdAt_idx"
  ON "SubscriptionChange"("subscriptionId", "createdAt");

ALTER TABLE "SubscriptionChange"
  ADD CONSTRAINT "SubscriptionChange_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionChange"
  ADD CONSTRAINT "SubscriptionChange_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InvoiceNote" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "requestedDueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceNote_invoiceId_createdAt_idx" ON "InvoiceNote"("invoiceId", "createdAt");

ALTER TABLE "InvoiceNote"
  ADD CONSTRAINT "InvoiceNote_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceNote"
  ADD CONSTRAINT "InvoiceNote_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceNote"
  ADD CONSTRAINT "InvoiceNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Alert"
  ADD COLUMN "evaluationKey" TEXT,
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgedById" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "lastEvaluatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Alert_evaluationKey_key" ON "Alert"("evaluationKey");
CREATE INDEX "Alert_organizationId_resolved_kind_idx" ON "Alert"("organizationId", "resolved", "kind");
