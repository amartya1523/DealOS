-- Preserve corrections as compensating ledger entries instead of deleting payments.
ALTER TABLE "Payment" ADD COLUMN "reversalOfId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "reason" TEXT;

CREATE UNIQUE INDEX "Payment_reversalOfId_key" ON "Payment"("reversalOfId");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_reversalOfId_fkey"
FOREIGN KEY ("reversalOfId") REFERENCES "Payment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
