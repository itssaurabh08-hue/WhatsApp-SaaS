import "server-only";
import { db } from "@/server/db/client";
import { generateToken, hashToken } from "./tokens";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Extend a session when less than half its lifetime remains.
const SESSION_RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2;
// Avoid a DB write on every request just to bump lastSeenAt.
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
}

export interface ValidatedSession {
  sessionId: string;
  expiresAt: Date;
  user: SessionUser;
}

export async function createSession(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string): Promise<ValidatedSession | null> {
  const sessionId = hashToken(token);
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          emailVerifiedAt: true,
          avatarUrl: true,
          isPlatformAdmin: true,
        },
      },
    },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.session.delete({ where: { id: sessionId } }).catch(() => undefined);
    return null;
  }

  let expiresAt = session.expiresAt;
  const needsRenewal = expiresAt.getTime() - now < SESSION_RENEW_THRESHOLD_MS;
  const needsTouch = now - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS;
  if (needsRenewal || needsTouch) {
    if (needsRenewal) expiresAt = new Date(now + SESSION_TTL_MS);
    await db.session.update({ where: { id: sessionId }, data: { expiresAt, lastSeenAt: new Date(now) } });
  }

  return { sessionId, expiresAt, user: session.user };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { id: hashToken(token) } });
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}
