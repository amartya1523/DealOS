-- Earlier releases used "fulfilled" for inventory reservation. Normalize legacy
-- rows so allocation and physical shipment have distinct, truthful states.
UPDATE "Order" SET "state" = 'PARTIALLY_ALLOCATED' WHERE "state" = 'PARTIALLY_FULFILLED';
UPDATE "Order" SET "state" = 'ALLOCATED' WHERE "state" = 'FULFILLED';
UPDATE "Fulfillment" SET "state" = 'PARTIALLY_ALLOCATED' WHERE "state" IN ('PARTIAL', 'RESERVED');
UPDATE "Fulfillment" SET "state" = 'ALLOCATED' WHERE "state" = 'FULFILLED';
