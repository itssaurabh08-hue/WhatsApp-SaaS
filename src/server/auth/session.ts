import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_TTL_MS, validateSessionToken, type ValidatedSession } from "./session-store";

export const SESSION_COOKIE = "session";

function cookieName() {
  // The __Host- prefix requires Secure, Path=/ and no Domain, which pins the cookie to this origin.
  return process.env.NODE_ENV === "production" ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(cookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSessionCookie() {
  const store = await cookies();
  // Overwrite with the same attributes: browsers ignore a __Host- cookie update that lacks Secure.
  store.set(cookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(cookieName())?.value ?? null;
}

/** Current session for this request, memoized per render. */
export const getCurrentSession = cache(async (): Promise<ValidatedSession | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  return validateSessionToken(token);
});

export async function requireSession(): Promise<ValidatedSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export { SESSION_TTL_MS };
