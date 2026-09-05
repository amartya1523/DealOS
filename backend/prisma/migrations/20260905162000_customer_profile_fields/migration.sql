ALTER TABLE "Customer"
ADD COLUMN "customerType" TEXT NOT NULL DEFAULT 'Business / Company',
ADD COLUMN "region" TEXT NOT NULL DEFAULT 'India',
ADD COLUMN "contactPerson" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "countryCode" TEXT NOT NULL DEFAULT '+91',
ADD COLUMN "gstin" TEXT,
ADD COLUMN "billingAddress" TEXT,
ADD COLUMN "shippingAddress" TEXT,
ADD COLUMN "paymentTerms" INTEGER NOT NULL DEFAULT 7;
