-- Customer account ownership is independent from quotation ownership. Existing Quote
-- owner/team values are intentionally never updated by this migration.
CREATE TYPE "CustomerRepresentativeRole" AS ENUM ('PRIMARY', 'COLLABORATOR');

ALTER TABLE "Customer"
  ADD COLUMN "primarySalesTeamId" TEXT,
  ADD COLUMN "assignmentVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Quote" ADD COLUMN "createdById" TEXT;
UPDATE "Quote" SET "createdById" = "ownerId" WHERE "createdById" IS NULL;
ALTER TABLE "Quote" ALTER COLUMN "createdById" SET NOT NULL;

CREATE TABLE "CustomerRepresentative" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "CustomerRepresentativeRole" NOT NULL,
  "assignedById" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CustomerRepresentative_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_primarySalesTeamId_fkey"
  FOREIGN KEY ("primarySalesTeamId") REFERENCES "SalesTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerRepresentative" ADD CONSTRAINT "CustomerRepresentative_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerRepresentative" ADD CONSTRAINT "CustomerRepresentative_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerRepresentative" ADD CONSTRAINT "CustomerRepresentative_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Customer_organizationId_primarySalesTeamId_idx"
  ON "Customer"("organizationId", "primarySalesTeamId");
CREATE INDEX "CustomerRepresentative_userId_active_idx"
  ON "CustomerRepresentative"("userId", "active");
CREATE INDEX "CustomerRepresentative_customerId_active_idx"
  ON "CustomerRepresentative"("customerId", "active");
CREATE INDEX "Quote_createdById_idx" ON "Quote"("createdById");

-- Prisma cannot express this predicate. It is the final integrity boundary for one
-- current primary representative while inactive historical rows remain available.
CREATE UNIQUE INDEX "CustomerRepresentative_one_active_primary"
  ON "CustomerRepresentative"("customerId")
  WHERE "role" = 'PRIMARY' AND "active" = true;

-- One-time reviewed backfill. The latest non-terminal quotation supplies account team.
-- No Quote column is written in this migration.
WITH latest_open_team AS (
  SELECT DISTINCT ON (q."customerId") q."customerId", q."teamId"
  FROM "Quote" q
  WHERE q."teamId" IS NOT NULL AND q."stage" NOT IN ('CONFIRMED', 'REJECTED')
  ORDER BY q."customerId", q."lastActivity" DESC, q."id" DESC
)
UPDATE "Customer" c
SET "primarySalesTeamId" = latest_open_team."teamId"
FROM latest_open_team
WHERE c."id" = latest_open_team."customerId";

WITH single_active_rep AS (
  SELECT q."customerId", MIN(q."ownerId") AS "userId"
  FROM "Quote" q
  JOIN "User" u ON u."id" = q."ownerId"
  GROUP BY q."customerId"
  HAVING COUNT(DISTINCT q."ownerId") = 1
     AND BOOL_AND(u."status" = 'ACTIVE' AND u."role" = 'REP')
)
INSERT INTO "CustomerRepresentative"
  ("id", "customerId", "userId", "role", "assignedById", "assignedAt", "active")
SELECT gen_random_uuid()::text, c."id", r."userId", 'PRIMARY', r."userId", CURRENT_TIMESTAMP, true
FROM "Customer" c
JOIN single_active_rep r ON r."customerId" = c."id"
JOIN "SalesTeamMember" stm
  ON stm."teamId" = c."primarySalesTeamId" AND stm."userId" = r."userId"
WHERE c."primarySalesTeamId" IS NOT NULL;

-- Customers left without an active PRIMARY are deliberately unresolved and must be
-- reviewed through the Assignment required filter before Rep scoping is enabled.
