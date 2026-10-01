-- CreateEnum
CREATE TYPE "WhatsAppAccountStatus" AS ENUM ('PENDING_SETUP', 'CONNECTED', 'NEEDS_RECONNECT', 'RESTRICTED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DEFERRED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'META_CLOUD',
    "businessAccountId" TEXT NOT NULL,
    "businessPortfolioId" TEXT,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "verifiedName" TEXT,
    "status" "WhatsAppAccountStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "statusDetail" TEXT,
    "qualityRating" TEXT,
    "messagingLimit" TEXT,
    "nameStatus" TEXT,
    "codeVerificationStatus" TEXT,
    "throughputLevel" TEXT,
    "accessTokenRef" TEXT,
    "registrationPinRef" TEXT,
    "webhooksSubscribedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'META',
    "dedupeKey" TEXT NOT NULL,
    "workspaceId" TEXT,
    "whatsappAccountId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderApiLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "whatsappAccountId" TEXT,
    "operation" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER,
    "success" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "errorCode" INTEGER,
    "errorSubcode" INTEGER,
    "errorMessage" TEXT,
    "fbtraceId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Credential_workspaceId_idx" ON "Credential"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_phoneNumberId_key" ON "WhatsAppAccount"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_workspaceId_idx" ON "WhatsAppAccount"("workspaceId");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_businessAccountId_idx" ON "WhatsAppAccount"("businessAccountId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_createdAt_idx" ON "WebhookEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_workspaceId_createdAt_idx" ON "WebhookEvent"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_dedupeKey_key" ON "WebhookEvent"("provider", "dedupeKey");

-- CreateIndex
CREATE INDEX "ProviderApiLog_workspaceId_createdAt_idx" ON "ProviderApiLog"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProviderApiLog_whatsappAccountId_createdAt_idx" ON "ProviderApiLog"("whatsappAccountId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderApiLog" ADD CONSTRAINT "ProviderApiLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
