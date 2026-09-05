ALTER TABLE "OrganizationInvitation"
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

UPDATE "OrganizationInvitation"
SET "acceptedAt" = "createdAt"
WHERE "status" = 'ACCEPTED' AND "acceptedAt" IS NULL;

UPDATE "OrganizationInvitation"
SET "revokedAt" = "createdAt"
WHERE "status" = 'REVOKED' AND "revokedAt" IS NULL;

-- Preserve one usable link for each customer/email before adding the final
-- concurrency boundary. Older pending links become explicitly revoked.
WITH ranked_pending AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "customerId", lower("email")
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "OrganizationInvitation"
  WHERE "customerId" IS NOT NULL AND "status" = 'PENDING'
)
UPDATE "OrganizationInvitation" invitation
SET "status" = 'REVOKED', "revokedAt" = CURRENT_TIMESTAMP
FROM ranked_pending
WHERE invitation."id" = ranked_pending."id" AND ranked_pending.position > 1;

CREATE UNIQUE INDEX "OrganizationInvitation_one_pending_customer_email"
  ON "OrganizationInvitation"("customerId", lower("email"))
  WHERE "customerId" IS NOT NULL AND "status" = 'PENDING';

CREATE INDEX "OrganizationInvitation_organizationId_customerId_createdAt_idx"
  ON "OrganizationInvitation"("organizationId", "customerId", "createdAt");
