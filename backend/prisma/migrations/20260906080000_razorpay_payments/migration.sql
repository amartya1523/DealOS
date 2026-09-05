CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'SUCCESS', 'FAILED');

ALTER TABLE "Payment"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "status" "PaymentStatus" NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "razorpayOrderId" TEXT,
  ADD COLUMN "razorpayPaymentId" TEXT,
  ADD COLUMN "razorpaySignature" TEXT,
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "failureDescription" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "paidAt" DROP NOT NULL;

UPDATE "Payment" AS payment
SET "organizationId" = invoice."organizationId",
    "verifiedAt" = payment."paidAt"
FROM "Invoice" AS invoice
WHERE invoice."id" = payment."invoiceId";

ALTER TABLE "Payment" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");
CREATE INDEX "Payment_organizationId_invoiceId_status_idx" ON "Payment"("organizationId", "invoiceId", "status");

CREATE TABLE "PaymentWebhookEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentWebhookEvent_eventKey_key" ON "PaymentWebhookEvent"("eventKey");
CREATE INDEX "PaymentWebhookEvent_organizationId_createdAt_idx" ON "PaymentWebhookEvent"("organizationId", "createdAt");
ALTER TABLE "PaymentWebhookEvent"
  ADD CONSTRAINT "PaymentWebhookEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
