-- Prisma manages @updatedAt values in application writes, so these columns
-- should not retain database-level defaults from the audit migration.
ALTER TABLE "Customer" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "updatedAt" DROP DEFAULT;
