ALTER TABLE "Session" ADD COLUMN "activeOrganizationId" TEXT;

ALTER TABLE "DirectoryJoinRequest"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "marketplaceInterest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedProductId" TEXT,
  ADD COLUMN "requestedProductName" TEXT,
  ADD COLUMN "requestedQuantity" DECIMAL(14,3),
  ADD COLUMN "portalPasswordHash" TEXT;

CREATE INDEX "DirectoryJoinRequest_requestedProductId_idx"
  ON "DirectoryJoinRequest"("requestedProductId");

ALTER TABLE "DirectoryJoinRequest"
  ADD CONSTRAINT "DirectoryJoinRequest_requestedProductId_fkey"
  FOREIGN KEY ("requestedProductId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
