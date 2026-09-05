ALTER TABLE "OrganizationInvitation"
ADD COLUMN "customerId" TEXT;

ALTER TABLE "OrganizationInvitation"
ADD CONSTRAINT "OrganizationInvitation_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "OrganizationInvitation_customerId_status_idx"
ON "OrganizationInvitation"("customerId", "status");
