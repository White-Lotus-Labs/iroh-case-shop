-- CreateTable
CREATE TABLE "NansenSnapshot" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "payload" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "refreshError" TEXT,
    "updatedAt" DATETIME NOT NULL
);
