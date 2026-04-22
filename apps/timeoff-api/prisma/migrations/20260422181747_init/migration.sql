-- CreateTable
CREATE TABLE "Balance" (
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "totalDays" DECIMAL NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "hcmLastSeenAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("employeeId", "locationId")
);

-- CreateTable
CREATE TABLE "TimeOffMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "delta" DECIMAL NOT NULL,
    "type" TEXT NOT NULL,
    "requestId" TEXT,
    "hcmSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TimeOffRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "days" DECIMAL NOT NULL,
    "status" TEXT NOT NULL,
    "sagaState" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OutboxEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TimeOffMovement_employeeId_locationId_createdAt_idx" ON "TimeOffMovement"("employeeId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "TimeOffMovement_requestId_idx" ON "TimeOffMovement"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeOffRequest_idempotencyKey_key" ON "TimeOffRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TimeOffRequest_employeeId_status_idx" ON "TimeOffRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "OutboxEntry_status_nextAttemptAt_idx" ON "OutboxEntry"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEntry_aggregateId_idx" ON "OutboxEntry"("aggregateId");
