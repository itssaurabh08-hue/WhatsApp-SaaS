import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { logger } from "@/server/logging/logger";
import type { RequestMeta } from "@/server/request-meta";

export type AuditAction =
  | "user.signup"
  | "user.login"
  | "user.login_failed"
  | "user.logout"
  | "user.email_verified"
  | "user.password_reset_requested"
  | "user.password_reset"
  | "workspace.created"
  | "workspace.settings_updated"
  | "workspace.member_invited"
  | "workspace.member_removed"
  | "workspace.member_role_changed"
  | "contact.deleted"
  | "contact.opt_in_changed"
  | "contacts.bulk_deleted"
  | "contacts.imported"
  | "contacts.exported"
  | "tag.deleted"
  | "segment.created"
  | "segment.updated"
  | "segment.deleted"
  | "custom_field.created"
  | "custom_field.deleted"
  | "whatsapp.connected"
  | "whatsapp.setup_failed"
  | "whatsapp.disconnected"
  | "template.created"
  | "template.deleted"
  | "templates.synced"
  | "conversation.assigned"
  | "conversation.status_changed"
  | "campaign.created"
  | "campaign.launched"
  | "campaign.paused"
  | "campaign.resumed"
  | "campaign.cancelled"
  | "campaign.deleted";

export interface AuditEntry {
  action: AuditAction;
  workspaceId?: string | null;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes an audit record. Audit failures are logged but never break the
 * user-facing operation that triggered them.
 */
export async function audit(entry: AuditEntry, meta?: Partial<RequestMeta>): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: entry.action,
        workspaceId: entry.workspaceId ?? null,
        actorUserId: entry.actorUserId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
        requestId: meta?.requestId ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, "audit log write failed");
  }
}
