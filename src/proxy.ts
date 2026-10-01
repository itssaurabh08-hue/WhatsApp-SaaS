import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page/API request:
 *  - assigns a correlation id (x-request-id) used by logs and audit records
 *  - sets a nonce-based Content Security Policy and other security headers
 *  - redirects unauthenticated visitors away from app routes (cookie presence
 *    only; the session is fully validated server-side in layouts/actions)
 *  - keeps the session cookie's browser expiry in step with the sliding
 *    database expiry
 */
const SESSION_COOKIES = ["session", "__Host-session"];
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const PROTECTED_PREFIXES = ["/w/", "/onboarding"];
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

// Pages that launch Meta's Embedded Signup need the Facebook JS SDK and its frames.
const FACEBOOK_SDK_PAGES = /^\/w\/[^/]+\/(setup|settings\/whatsapp)\/?$/;

function buildCsp(nonce: string, isDev: boolean, allowFacebook: boolean) {
  const fb = allowFacebook ? " https://connect.facebook.net https://*.facebook.com" : "";
  return [
    "default-src 'self'",
    // With 'strict-dynamic', scripts are trusted via the nonce; the Facebook SDK is inserted by our own nonce'd code.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}${allowFacebook ? " https://connect.facebook.net" : ""}`,
    // Inline style attributes are used by Radix/Sonner positioning; scripts remain nonce-locked.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    `connect-src 'self'${fb}`,
    ...(allowFacebook ? ["frame-src https://*.facebook.com"] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const incomingId = request.headers.get("x-request-id");
  const requestId = incomingId && REQUEST_ID_PATTERN.test(incomingId) ? incomingId : crypto.randomUUID();
  const { pathname, search } = request.nextUrl;

  const sessionCookie = SESSION_COOKIES.map((name) => request.cookies.get(name)).find(Boolean);
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
  if (isProtected && !sessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    const res = NextResponse.redirect(url);
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, isDev, FACEBOOK_SDK_PAGES.test(pathname));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!isDev) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");

  if (sessionCookie) {
    response.cookies.set(sessionCookie.name, sessionCookie.value, {
      httpOnly: true,
      secure: sessionCookie.name.startsWith("__Host-"),
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|logo.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
