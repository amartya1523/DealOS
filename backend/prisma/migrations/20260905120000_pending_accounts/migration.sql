-- Preserve existing enabled demo identities; new identities default to pending.
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');
ALTER TABLE "User" ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'PENDING';
