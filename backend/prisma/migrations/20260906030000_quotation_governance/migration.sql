CREATE TYPE "ApprovalCaseState" AS ENUM ('PENDING', 'APPROVED', 'RETURNED', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "ApprovalRoute" AS ENUM ('NONE', 'MANAGER', 'MANAGER_FINANCE');

ALTER TABLE "DiscountPolicy"
  ADD COLUMN "aggregateDiscountLimit" DECIMAL(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN "minimumMarginPercent" DECIMAL(5,2) NOT NULL DEFAULT 12;

ALTER TABLE "DiscountPolicy"
  ADD CONSTRAINT "DiscountPolicy_aggregateDiscountLimit_check" CHECK ("aggregateDiscountLimit" >= 0 AND "aggregateDiscountLimit" <= 100),
  ADD CONSTRAINT "DiscountPolicy_minimumMarginPercent_check" CHECK ("minimumMarginPercent" >= -100 AND "minimumMarginPercent" <= 100);

CREATE TABLE "ApprovalCase" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "quoteId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "policyId" TEXT,
  "cycle" INTEGER NOT NULL,
  "state" "ApprovalCaseState" NOT NULL DEFAULT 'PENDING',
  "route" "ApprovalRoute" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "riskSnapshot" JSONB NOT NULL,
  "submittedById" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalCase_version_check" CHECK ("version" >= 1)
);

ALTER TABLE "Approval" ADD COLUMN "caseId" TEXT;

INSERT INTO "ApprovalCase" (
  "quoteId", "revisionId", "policyId", "cycle", "state", "route", "riskSnapshot",
  "submittedById", "completedAt", "createdAt", "updatedAt"
)
SELECT
  a."quoteId",
  a."revisionId",
  NULLIF(r."policySnapshot"->>'id', ''),
  a."cycle",
  CASE
    WHEN bool_or(a."state" IN ('PENDING', 'WAITING')) THEN 'PENDING'::"ApprovalCaseState"
    WHEN bool_or(a."state" = 'RETURNED') THEN 'RETURNED'::"ApprovalCaseState"
    WHEN bool_or(a."state" = 'REJECTED') THEN 'REJECTED'::"ApprovalCaseState"
    WHEN bool_and(a."state" = 'APPROVED') THEN 'APPROVED'::"ApprovalCaseState"
    ELSE 'SUPERSEDED'::"ApprovalCaseState"
  END,
  CASE WHEN bool_or(a."step" = 'Finance') THEN 'MANAGER_FINANCE'::"ApprovalRoute" ELSE 'MANAGER'::"ApprovalRoute" END,
  jsonb_build_object('legacyPolicySnapshot', r."policySnapshot"),
  COALESCE(r."submittedById", q."ownerId"),
  CASE WHEN bool_or(a."state" IN ('PENDING', 'WAITING')) THEN NULL ELSE max(a."decidedAt") END,
  min(a."createdAt"),
  max(COALESCE(a."decidedAt", a."createdAt"))
FROM "Approval" a
JOIN "QuoteRevision" r ON r."id" = a."revisionId"
JOIN "Quote" q ON q."id" = a."quoteId"
GROUP BY a."quoteId", a."revisionId", r."policySnapshot", r."submittedById", q."ownerId", a."cycle";

UPDATE "Approval" a
SET "caseId" = c."id"
FROM "ApprovalCase" c
WHERE c."quoteId" = a."quoteId" AND c."cycle" = a."cycle";

ALTER TABLE "Approval" ALTER COLUMN "caseId" SET NOT NULL;

CREATE UNIQUE INDEX "ApprovalCase_quoteId_cycle_key" ON "ApprovalCase"("quoteId", "cycle");
CREATE INDEX "ApprovalCase_revisionId_state_idx" ON "ApprovalCase"("revisionId", "state");
CREATE INDEX "ApprovalCase_state_createdAt_idx" ON "ApprovalCase"("state", "createdAt");
CREATE UNIQUE INDEX "Approval_caseId_sequence_key" ON "Approval"("caseId", "sequence");

ALTER TABLE "ApprovalCase" ADD CONSTRAINT "ApprovalCase_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalCase" ADD CONSTRAINT "ApprovalCase_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalCase" ADD CONSTRAINT "ApprovalCase_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DiscountPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalCase" ADD CONSTRAINT "ApprovalCase_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ApprovalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
