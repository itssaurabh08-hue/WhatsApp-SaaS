import { afterAll, beforeEach } from "vitest";
import { applyTestEnv } from "./test-env";

applyTestEnv();

const { db } = await import("@/server/db/client");
const { MemoryEmailProvider, setEmailProvider } = await import("@/server/email/provider");

beforeEach(async () => {
  // Truncate every application table between tests for isolation.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  setEmailProvider(new MemoryEmailProvider());
});

afterAll(async () => {
  await db.$disconnect();
  const { getRedis } = await import("@/server/redis");
  getRedis().disconnect();
});
