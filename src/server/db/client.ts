import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { assertTenantScoped } from "./tenant-guard";

function createBaseClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

function withTenantGuard(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          assertTenantScoped(model, operation, args as Record<string, unknown> | undefined);
          return query(args);
        },
      },
    },
  });
}

export type Db = ReturnType<typeof withTenantGuard>;

const globalForDb = globalThis as unknown as { __db?: Db; __systemDb?: PrismaClient };

const base = globalForDb.__systemDb ?? createBaseClient();

/** Shared Prisma client with the tenant guard. Use this everywhere by default. */
export const db: Db = globalForDb.__db ?? withTenantGuard(base);

/**
 * Unguarded client for the few operations that are inherently cross-tenant:
 * routing inbound webhooks by phone number ID and enforcing that a phone
 * number is connected to only one workspace. Never use it for user-driven
 * reads or writes of tenant data.
 */
export const systemDb: PrismaClient = base;

if (process.env.NODE_ENV !== "production") {
  globalForDb.__db = db;
  globalForDb.__systemDb = base;
}
