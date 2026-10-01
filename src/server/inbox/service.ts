import "server-only";
import type { ConversationStatus, Prisma } from "@/generated/prisma/client";
import { roleHasPermission, type Role } from "@/lib/permissions";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { createOutboundMessage, type OutboundRequest } from "@/server/messaging/outbound";
import type { RequestMeta } from "@/server/request-meta";

type Meta = Partial<RequestMeta>;

export type InboxFilter = "open" | "mine" | "unassigned" | "pending" | "closed" | "all";

const CONTACT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  normalizedPhoneNumber: true,
  email: true,
  company: true,
  optInStatus: true,
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.ContactSelect;

export async function listConversations(
  ctx: TenantContext,
  opts: { filter?: InboxFilter; q?: string; take?: number } = {},
) {
  requirePermission(ctx, "inbox:read");
  const where: Prisma.ConversationWhereInput = { workspaceId: ctx.workspaceId, lastMessageAt: { not: null } };
  switch (opts.filter ?? "open") {
    case "open":
      where.status = "OPEN";
      break;
    case "pending":
      where.status = "PENDING";
      break;
    case "closed":
      where.status = "CLOSED";
      break;
    case "mine":
      where.assignedUserId = ctx.user.id;
      where.status = { not: "CLOSED" };
      break;
    case "unassigned":
      where.assignedUserId = null;
      where.status = { not: "CLOSED" };
      break;
  }
  const q = opts.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.contact = {
      workspaceId: ctx.workspaceId,
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ normalizedPhoneNumber: { contains: digits } }] : []),
      ],
    };
  }
  return db.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: opts.take ?? 100,
    select: {
      id: true,
      status: true,
      unreadCount: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      lastInboundAt: true,
      assignedUser: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
      whatsappAccount: { select: { id: true, displayPhoneNumber: true } },
    },
  });
}

export async function getConversation(ctx: TenantContext, id: string) {
  requirePermission(ctx, "inbox:read");
  const conversation = await db.conversation.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: {
      id: true,
      status: true,
      unreadCount: true,
      lastInboundAt: true,
      lastMessageAt: true,
      assignedUserId: true,
      assignedUser: { select: { id: true, name: true } },
      contact: { select: CONTACT_SELECT },
      whatsappAccount: { select: { id: true, displayPhoneNumber: true, verifiedName: true, status: true } },
    },
  });
  if (!conversation) throw new AppError("NOT_FOUND");
  return conversation;
}

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  type: true,
  body: true,
  payload: true,
  status: true,
  errorMessage: true,
  contextMessageId: true,
  whatsappMessageId: true,
  createdAt: true,
  receivedAt: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  failedAt: true,
  sentBy: { select: { name: true } },
  template: { select: { name: true } },
  mediaObject: { select: { id: true, mimeType: true, fileName: true, size: true, status: true } },
} satisfies Prisma.MessageSelect;

/** Latest messages of a conversation, oldest first. Notes are a separate table and never mixed in here. */
export async function listMessages(ctx: TenantContext, conversationId: string, take = 100) {
  requirePermission(ctx, "inbox:read");
  const rows = await db.message.findMany({
    where: { workspaceId: ctx.workspaceId, conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: MESSAGE_SELECT,
  });
  return rows.reverse();
}

export async function listConversationNotes(ctx: TenantContext, conversationId: string) {
  requirePermission(ctx, "inbox:read");
  return db.conversationNote.findMany({
    where: { workspaceId: ctx.workspaceId, conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
  });
}

/** Internal note. Notes live in ConversationNote and have no path to the WhatsApp send queue. */
export async function addConversationNote(ctx: TenantContext, conversationId: string, body: string) {
  requirePermission(ctx, "inbox:reply");
  const text = body.trim();
  if (!text) throw new AppError("VALIDATION", { userMessage: "Write a note first." });
  if (text.length > 5000) throw new AppError("VALIDATION", { userMessage: "Notes can be at most 5000 characters." });
  await requireConversation(ctx, conversationId);
  return db.conversationNote.create({
    data: { workspaceId: ctx.workspaceId, conversationId, authorId: ctx.user.id, body: text },
  });
}

async function requireConversation(ctx: TenantContext, id: string) {
  const conversation = await db.conversation.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!conversation) throw new AppError("NOT_FOUND");
  return conversation;
}

/** Members who can be assigned conversations (anyone who can reply). */
export async function listAssignableMembers(ctx: TenantContext) {
  requirePermission(ctx, "inbox:read");
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { role: true, user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.filter((m) => roleHasPermission(m.role as Role, "inbox:reply")).map((m) => m.user);
}

export async function assignConversation(ctx: TenantContext, id: string, userId: string | null, meta: Meta = {}) {
  requirePermission(ctx, "inbox:assign");
  await requireConversation(ctx, id);
  if (userId) {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: ctx.workspaceId, userId },
      select: { role: true },
    });
    if (!member || !roleHasPermission(member.role as Role, "inbox:reply")) {
      throw new AppError("VALIDATION", { userMessage: "That person cannot be assigned conversations." });
    }
  }
  await db.conversation.updateMany({ where: { id, workspaceId: ctx.workspaceId }, data: { assignedUserId: userId } });
  await audit(
    {
      action: "conversation.assigned",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Conversation",
      entityId: id,
      metadata: { assignedUserId: userId },
    },
    meta,
  );
}

export async function setConversationStatus(
  ctx: TenantContext,
  id: string,
  status: ConversationStatus,
  meta: Meta = {},
) {
  requirePermission(ctx, "inbox:reply");
  await requireConversation(ctx, id);
  await db.conversation.updateMany({
    where: { id, workspaceId: ctx.workspaceId },
    data: { status, ...(status === "CLOSED" ? { unreadCount: 0 } : {}) },
  });
  await audit(
    {
      action: "conversation.status_changed",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Conversation",
      entityId: id,
      metadata: { status },
    },
    meta,
  );
}

export async function markConversationRead(ctx: TenantContext, id: string) {
  requirePermission(ctx, "inbox:read");
  await db.conversation.updateMany({
    where: { id, workspaceId: ctx.workspaceId, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  });
}

function requireCanSend(ctx: TenantContext) {
  requirePermission(ctx, "inbox:reply");
  if (!ctx.user.emailVerifiedAt) {
    throw new AppError("FORBIDDEN", { userMessage: "Verify your email address before sending messages." });
  }
}

/** Reply in an existing conversation. */
export async function sendReply(
  ctx: TenantContext,
  input: {
    conversationId: string;
    request: OutboundRequest;
    idempotencyKey?: string | null;
    replyToMessageId?: string | null;
  },
) {
  requireCanSend(ctx);
  const conversation = await requireConversation(ctx, input.conversationId);
  let contextMessageId: string | null = null;
  if (input.replyToMessageId) {
    const target = await db.message.findFirst({
      where: { id: input.replyToMessageId, workspaceId: ctx.workspaceId, conversationId: conversation.id },
      select: { whatsappMessageId: true },
    });
    contextMessageId = target?.whatsappMessageId ?? null;
  }
  return createOutboundMessage({
    workspaceId: ctx.workspaceId,
    contactId: conversation.contactId,
    whatsappAccountId: conversation.whatsappAccountId,
    request: input.request,
    sentById: ctx.user.id,
    idempotencyKey: input.idempotencyKey ? `inbox:${ctx.user.id}:${input.idempotencyKey}` : null,
    contextMessageId,
  });
}

/** Starts (or continues) a conversation with a template, e.g. from a contact's page. */
export async function startConversation(
  ctx: TenantContext,
  input: {
    contactId: string;
    whatsappAccountId: string;
    request: Extract<OutboundRequest, { kind: "template" }>;
    idempotencyKey?: string | null;
  },
) {
  requireCanSend(ctx);
  const message = await createOutboundMessage({
    workspaceId: ctx.workspaceId,
    contactId: input.contactId,
    whatsappAccountId: input.whatsappAccountId,
    request: input.request,
    sentById: ctx.user.id,
    idempotencyKey: input.idempotencyKey ? `inbox:${ctx.user.id}:${input.idempotencyKey}` : null,
  });
  return message;
}

export async function inboxUnreadCount(ctx: TenantContext) {
  const r = await db.conversation.aggregate({
    where: { workspaceId: ctx.workspaceId, status: { not: "CLOSED" }, unreadCount: { gt: 0 } },
    _count: true,
  });
  return r._count;
}
