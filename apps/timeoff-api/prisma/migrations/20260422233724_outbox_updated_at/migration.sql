/*
  Warnings:

  - Added the required column `updatedAt` to the `OutboxEntry` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OutboxEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_OutboxEntry" ("aggregateId", "attempts", "createdAt", "eventType", "id", "lastError", "nextAttemptAt", "payload", "status", "updatedAt") SELECT "aggregateId", "attempts", "createdAt", "eventType", "id", "lastError", "nextAttemptAt", "payload", "status", CURRENT_TIMESTAMP FROM "OutboxEntry";
DROP TABLE "OutboxEntry";
ALTER TABLE "new_OutboxEntry" RENAME TO "OutboxEntry";
CREATE INDEX "OutboxEntry_status_nextAttemptAt_idx" ON "OutboxEntry"("status", "nextAttemptAt");
CREATE INDEX "OutboxEntry_aggregateId_idx" ON "OutboxEntry"("aggregateId");
CREATE INDEX "OutboxEntry_status_updatedAt_idx" ON "OutboxEntry"("status", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
