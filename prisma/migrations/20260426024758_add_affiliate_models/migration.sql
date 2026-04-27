-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commissionRate" REAL NOT NULL DEFAULT 10.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderTotal" REAL NOT NULL,
    "appFee" REAL NOT NULL,
    "affiliateFee" REAL NOT NULL,
    "pixelEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Conversion_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cappedAmount" REAL NOT NULL DEFAULT 100.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Affiliate_shopDomain_idx" ON "Affiliate"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_shopDomain_code_key" ON "Affiliate"("shopDomain", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_pixelEventId_key" ON "Conversion"("pixelEventId");

-- CreateIndex
CREATE INDEX "Conversion_shopDomain_idx" ON "Conversion"("shopDomain");

-- CreateIndex
CREATE INDEX "Conversion_affiliateId_idx" ON "Conversion"("affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_shopDomain_orderId_key" ON "Conversion"("shopDomain", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_shopDomain_key" ON "BillingSubscription"("shopDomain");

-- CreateIndex
CREATE INDEX "BillingSubscription_shopDomain_idx" ON "BillingSubscription"("shopDomain");
