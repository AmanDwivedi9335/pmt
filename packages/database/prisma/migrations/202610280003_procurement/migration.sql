-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "taxId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "approvedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "boqItemId" UUID NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "rate" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "purchaseLineId" UUID NOT NULL,
    "challan" TEXT NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "dispatchId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "accepted" DECIMAL(20,4) NOT NULL,
    "damaged" DECIMAL(20,4) NOT NULL,
    "rejected" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_orgId_name_idx" ON "Supplier"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_orgId_key" ON "Supplier"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orgId_number_key" ON "PurchaseOrder"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_orgId_key" ON "PurchaseOrder"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseLine_id_orgId_key" ON "PurchaseLine"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseLine_purchaseOrderId_boqItemId_key" ON "PurchaseLine"("purchaseOrderId", "boqItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_orgId_challan_purchaseLineId_key" ON "Dispatch"("orgId", "challan", "purchaseLineId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_id_orgId_key" ON "Dispatch"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_orgId_dispatchId_reference_key" ON "GoodsReceipt"("orgId", "dispatchId", "reference");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_orgId_fkey" FOREIGN KEY ("supplierId", "orgId") REFERENCES "Supplier"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseOrderId_orgId_fkey" FOREIGN KEY ("purchaseOrderId", "orgId") REFERENCES "PurchaseOrder"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_boqItemId_orgId_fkey" FOREIGN KEY ("boqItemId", "orgId") REFERENCES "BoqItem"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_purchaseLineId_orgId_fkey" FOREIGN KEY ("purchaseLineId", "orgId") REFERENCES "PurchaseLine"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_dispatchId_orgId_fkey" FOREIGN KEY ("dispatchId", "orgId") REFERENCES "Dispatch"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;
