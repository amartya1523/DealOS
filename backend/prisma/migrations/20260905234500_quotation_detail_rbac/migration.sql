-- Add normalized sales teams and quote assignment without rewriting existing quotations.
CREATE TABLE "SalesTeam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesTeamMember_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Quote" ADD COLUMN "teamId" TEXT;

CREATE UNIQUE INDEX "SalesTeam_organizationId_name_key" ON "SalesTeam"("organizationId", "name");
CREATE INDEX "SalesTeam_organizationId_managerId_idx" ON "SalesTeam"("organizationId", "managerId");
CREATE UNIQUE INDEX "SalesTeamMember_teamId_userId_key" ON "SalesTeamMember"("teamId", "userId");
CREATE INDEX "SalesTeamMember_userId_teamId_idx" ON "SalesTeamMember"("userId", "teamId");
CREATE INDEX "Quote_organizationId_teamId_lastActivity_id_idx" ON "Quote"("organizationId", "teamId", "lastActivity", "id");

ALTER TABLE "SalesTeam" ADD CONSTRAINT "SalesTeam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesTeam" ADD CONSTRAINT "SalesTeam_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesTeamMember" ADD CONSTRAINT "SalesTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesTeamMember" ADD CONSTRAINT "SalesTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
