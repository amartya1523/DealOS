ALTER TABLE "QuoteRevision"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "promisedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "terms" TEXT;

CREATE INDEX IF NOT EXISTS "Quote_organizationId_stage_lastActivity_id_idx"
  ON "Quote"("organizationId", "stage", "lastActivity", "id");

CREATE INDEX IF NOT EXISTS "Quote_organizationId_ownerId_lastActivity_id_idx"
  ON "Quote"("organizationId", "ownerId", "lastActivity", "id");
