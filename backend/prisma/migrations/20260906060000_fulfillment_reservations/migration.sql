CREATE TYPE "BackorderState" AS ENUM ('OPEN', 'FULFILLED');
CREATE TYPE "StockMovementKind" AS ENUM ('RECEIPT');

ALTER TABLE "Fulfillment"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "overridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reason" TEXT;

CREATE TABLE "Reservation" (
  "id" TEXT NOT NULL,
  "fulfillmentId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "stockBalanceId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Reservation_positive_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "Reservation_orderLineId_stockBalanceId_key"
  ON "Reservation"("orderLineId", "stockBalanceId");
CREATE INDEX "Reservation_orderId_createdAt_idx" ON "Reservation"("orderId", "createdAt");
CREATE INDEX "Reservation_stockBalanceId_idx" ON "Reservation"("stockBalanceId");

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_fulfillmentId_fkey"
  FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_stockBalanceId_fkey"
  FOREIGN KEY ("stockBalanceId") REFERENCES "StockBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Backorder" (
  "id" TEXT NOT NULL,
  "fulfillmentId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "originalQuantity" INTEGER NOT NULL,
  "remainingQuantity" INTEGER NOT NULL,
  "state" "BackorderState" NOT NULL DEFAULT 'OPEN',
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Backorder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Backorder_quantity_check" CHECK (
    "originalQuantity" > 0 AND
    "remainingQuantity" >= 0 AND
    "remainingQuantity" <= "originalQuantity"
  ),
  CONSTRAINT "Backorder_state_quantity_check" CHECK (
    ("state" = 'OPEN' AND "remainingQuantity" > 0 AND "fulfilledAt" IS NULL) OR
    ("state" = 'FULFILLED' AND "remainingQuantity" = 0 AND "fulfilledAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "Backorder_orderLineId_key" ON "Backorder"("orderLineId");
CREATE INDEX "Backorder_orderId_state_idx" ON "Backorder"("orderId", "state");
CREATE INDEX "Backorder_productId_state_idx" ON "Backorder"("productId", "state");

ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_fulfillmentId_fkey"
  FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stockBalanceId" TEXT NOT NULL,
  "orderId" TEXT,
  "productId" TEXT NOT NULL,
  "kind" "StockMovementKind" NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "reference" TEXT,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockMovement_positive_receipt_check" CHECK ("quantityDelta" > 0)
);

CREATE INDEX "StockMovement_stockBalanceId_createdAt_idx" ON "StockMovement"("stockBalanceId", "createdAt");
CREATE INDEX "StockMovement_orderId_createdAt_idx" ON "StockMovement"("orderId", "createdAt");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockBalanceId_fkey"
  FOREIGN KEY ("stockBalanceId") REFERENCES "StockBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve already committed compatibility allocations as first-class reservations.
WITH split_rows AS (
  SELECT
    f."id" AS "fulfillmentId",
    f."orderId",
    row->>'productId' AS "productId",
    row->>'warehouseId' AS "warehouseId",
    SUM((row->>'quantity')::integer) AS quantity
  FROM "Fulfillment" f
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f."split"->'split', '[]'::jsonb)) row
  WHERE f."orderId" IS NOT NULL
  GROUP BY f."id", f."orderId", row->>'productId', row->>'warehouseId'
)
INSERT INTO "Reservation" (
  "id", "fulfillmentId", "orderId", "orderLineId", "stockBalanceId", "quantity", "source"
)
SELECT
  gen_random_uuid()::text,
  sr."fulfillmentId",
  sr."orderId",
  ol."id",
  sb."id",
  sr.quantity,
  'LEGACY_BACKFILL'
FROM split_rows sr
JOIN LATERAL (
  SELECT "id" FROM "OrderLine"
  WHERE "orderId" = sr."orderId" AND "productId" = sr."productId"
  ORDER BY "createdAt", "id"
  LIMIT 1
) ol ON true
JOIN "StockBalance" sb
  ON sb."warehouseId" = sr."warehouseId" AND sb."productId" = sr."productId"
WHERE sr.quantity > 0;

WITH backorder_rows AS (
  SELECT
    f."id" AS "fulfillmentId",
    f."orderId",
    row->>'productId' AS "productId",
    SUM((row->>'quantity')::integer) AS quantity
  FROM "Fulfillment" f
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f."split"->'backorders', '[]'::jsonb)) row
  WHERE f."orderId" IS NOT NULL
  GROUP BY f."id", f."orderId", row->>'productId'
)
INSERT INTO "Backorder" (
  "id", "fulfillmentId", "orderId", "orderLineId", "productId", "productName",
  "originalQuantity", "remainingQuantity", "state"
)
SELECT
  gen_random_uuid()::text,
  br."fulfillmentId",
  br."orderId",
  ol."id",
  br."productId",
  COALESCE(ol."snapshot"->>'name', p."name"),
  br.quantity,
  br.quantity,
  'OPEN'
FROM backorder_rows br
JOIN LATERAL (
  SELECT "id", "snapshot" FROM "OrderLine"
  WHERE "orderId" = br."orderId" AND "productId" = br."productId"
  ORDER BY "createdAt", "id"
  LIMIT 1
) ol ON true
JOIN "Product" p ON p."id" = br."productId"
WHERE br.quantity > 0;
