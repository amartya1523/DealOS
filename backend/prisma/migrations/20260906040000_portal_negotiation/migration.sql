ALTER TABLE "Negotiation"
  ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'COMMENT',
  ADD COLUMN "requestedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "respondedById" TEXT,
  ADD COLUMN "responseReason" TEXT,
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "adoptedRevisionId" TEXT;

CREATE INDEX "Negotiation_quoteId_revisionId_kind_state_idx"
  ON "Negotiation"("quoteId", "revisionId", "kind", "state");

ALTER TABLE "Negotiation"
  ADD CONSTRAINT "Negotiation_counterDiscount_check"
  CHECK ("counterDiscount" IS NULL OR ("counterDiscount" >= 0 AND "counterDiscount" <= 100));
