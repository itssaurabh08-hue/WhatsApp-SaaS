import { db } from "@/server/db/client";
import { getRedis } from "@/server/redis";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe. Reports dependency status without exposing details. */
export async function GET() {
  const checks: Record<string, "ok" | "error"> = { database: "ok", redis: "ok" };
  await db.$queryRaw`SELECT 1`.catch(() => (checks.database = "error"));
  await getRedis()
    .ping()
    .catch(() => (checks.redis = "error"));
  const healthy = Object.values(checks).every((v) => v === "ok");
  return Response.json({ status: healthy ? "ok" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
