ALTER TYPE "OrderState" ADD VALUE IF NOT EXISTS 'PARTIALLY_ALLOCATED';
ALTER TYPE "OrderState" ADD VALUE IF NOT EXISTS 'ALLOCATED';
ALTER TYPE "OrderState" ADD VALUE IF NOT EXISTS 'PARTIALLY_SHIPPED';
ALTER TYPE "OrderState" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE "FulfillmentState" ADD VALUE IF NOT EXISTS 'PARTIALLY_ALLOCATED';
ALTER TYPE "FulfillmentState" ADD VALUE IF NOT EXISTS 'ALLOCATED';
ALTER TYPE "StockMovementKind" ADD VALUE IF NOT EXISTS 'SHIPMENT';
ALTER TYPE "SubscriptionChangeKind" ADD VALUE IF NOT EXISTS 'PRORATED';

CREATE TYPE "ShipmentState" AS ENUM ('DRAFT', 'SHIPPED');
CREATE TYPE "BillingPeriodState" AS ENUM ('OPEN', 'INVOICED');
CREATE TYPE "NotificationState" AS ENUM ('UNREAD', 'READ');

ALTER TABLE "Customer" ADD COLUMN "defaultPriceListId" TEXT;
ALTER TABLE "DiscountPolicy" ADD COLUMN "approvalSequence" TEXT[] NOT NULL DEFAULT ARRAY['Sales Manager', 'Finance']::TEXT[], ADD COLUMN "managerReviewerId" TEXT, ADD COLUMN "financeReviewerId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "priceListId" TEXT;
ALTER TABLE "QuoteLine" ADD COLUMN "variantId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipmentId" TEXT;

CREATE TABLE "ProductVariant" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "costDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE UNIQUE INDEX "ProductVariant_productId_name_key" ON "ProductVariant"("productId", "name");
CREATE INDEX "ProductVariant_organizationId_productId_active_idx" ON "ProductVariant"("organizationId", "productId", "active");

CREATE TABLE "PriceList" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "customerTier" TEXT,
  "currency" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PriceList_organizationId_name_currency_key" ON "PriceList"("organizationId", "name", "currency");
CREATE INDEX "PriceList_organizationId_customerTier_currency_active_idx" ON "PriceList"("organizationId", "customerTier", "currency", "active");

CREATE TABLE "PriceListItem" (
  "id" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PriceListItem_priceListId_productId_variantId_key" ON "PriceListItem"("priceListId", "productId", "variantId");
CREATE UNIQUE INDEX "PriceListItem_base_product_key" ON "PriceListItem"("priceListId", "productId") WHERE "variantId" IS NULL;
CREATE INDEX "PriceListItem_productId_variantId_idx" ON "PriceListItem"("productId", "variantId");

CREATE TABLE "Shipment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "state" "ShipmentState" NOT NULL DEFAULT 'DRAFT',
  "carrier" TEXT,
  "trackingNumber" TEXT,
  "shippedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Shipment_number_key" ON "Shipment"("number");
CREATE INDEX "Shipment_organizationId_state_createdAt_idx" ON "Shipment"("organizationId", "state", "createdAt");
CREATE INDEX "Shipment_orderId_createdAt_idx" ON "Shipment"("orderId", "createdAt");

CREATE TABLE "ShipmentLine" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShipmentLine_shipmentId_orderLineId_key" ON "ShipmentLine"("shipmentId", "orderLineId");
CREATE INDEX "ShipmentLine_orderLineId_idx" ON "ShipmentLine"("orderLineId");

CREATE TABLE "BillingPeriod" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "proration" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "state" "BillingPeriodState" NOT NULL DEFAULT 'OPEN',
  "invoiceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingPeriod_invoiceId_key" ON "BillingPeriod"("invoiceId");
CREATE UNIQUE INDEX "BillingPeriod_subscriptionId_periodStart_periodEnd_key" ON "BillingPeriod"("subscriptionId", "periodStart", "periodEnd");
CREATE INDEX "BillingPeriod_organizationId_state_periodEnd_idx" ON "BillingPeriod"("organizationId", "state", "periodEnd");

CREATE TABLE "CreditNote" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");
CREATE INDEX "CreditNote_organizationId_invoiceId_idx" ON "CreditNote"("organizationId", "invoiceId");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "state" "NotificationState" NOT NULL DEFAULT 'UNREAD',
  "dedupeKey" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_recipientId_state_createdAt_idx" ON "Notification"("recipientId", "state", "createdAt");

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_defaultPriceListId_fkey" FOREIGN KEY ("defaultPriceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingPeriod" ADD CONSTRAINT "BillingPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingPeriod" ADD CONSTRAINT "BillingPeriod_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingPeriod" ADD CONSTRAINT "BillingPeriod_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "RecommendationActionKind" AS ENUM ('ACCEPTED', 'DISMISSED');
CREATE TABLE "RecommendationAction" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" "RecommendationActionKind" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecommendationAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecommendationAction_quoteId_productId_key" ON "RecommendationAction"("quoteId", "productId");
CREATE INDEX "RecommendationAction_actorId_createdAt_idx" ON "RecommendationAction"("actorId", "createdAt");
ALTER TABLE "RecommendationAction" ADD CONSTRAINT "RecommendationAction_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationAction" ADD CONSTRAINT "RecommendationAction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationAction" ADD CONSTRAINT "RecommendationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
