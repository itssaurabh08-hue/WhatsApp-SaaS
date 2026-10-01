/**
 * Development seed. Creates a clearly labeled demo workspace and demo users.
 * Refuses to run in production unless ALLOW_DEMO_SEED=true is set explicitly.
 * Later phases extend this with demo contacts, conversations and campaigns.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type WorkspaceRole } from "../src/generated/prisma/client";

const DEMO_PASSWORD = "demo-password-123";
const DEMO_SLUG = "demo";

const DEMO_USERS: { email: string; name: string; role: WorkspaceRole }[] = [
  { email: "owner@demo.example.com", name: "Demo Owner", role: "OWNER" },
  { email: "admin@demo.example.com", name: "Demo Admin", role: "ADMIN" },
  { email: "agent@demo.example.com", name: "Demo Agent", role: "AGENT" },
  { email: "analyst@demo.example.com", name: "Demo Analyst", role: "ANALYST" },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=true to override.");
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    const workspace = await db.workspace.upsert({
      where: { slug: DEMO_SLUG },
      update: {},
      create: {
        name: "Demo Workspace (demo data)",
        slug: DEMO_SLUG,
        businessName: "Demo Business",
        timezone: "UTC",
        currency: "USD",
        onboardingStep: "WHATSAPP",
        isDemo: true,
      },
    });
    for (const u of DEMO_USERS) {
      const user = await db.user.upsert({
        where: { email: u.email },
        update: {},
        create: { email: u.email, name: u.name, passwordHash, emailVerifiedAt: new Date(), isDemo: true },
      });
      await db.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
        update: { role: u.role },
        create: { workspaceId: workspace.id, userId: user.id, role: u.role },
      });
    }
    console.log(`Seeded demo workspace "/w/${DEMO_SLUG}" with users (password: ${DEMO_PASSWORD}):`);
    for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
