import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { assertTenantScoped } from "./tenant-guard";

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const base = new PrismaClient({ adapter });
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

export type Db = ReturnType<typeof createClient>;

const globalForDb = globalThis as unknown as { __db?: Db };

/** Shared Prisma client. Reused across hot reloads in development. */
export const db: Db = globalForDb.__db ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.__db = db;
