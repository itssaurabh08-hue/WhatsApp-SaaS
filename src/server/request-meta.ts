import "server-only";
import { headers } from "next/headers";

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Client metadata for audit logs and rate limiting. Must be called in a request scope. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return {
    ipAddress,
    userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
    requestId: h.get("x-request-id"),
  };
}
