/**
 * Development seed. Creates a clearly labeled demo workspace and demo users.
 * Refuses to run in production unless ALLOW_DEMO_SEED=true is set explicitly.
 * Includes demo contacts, tags, a list, a custom field and a segment. Later
 * phases extend this with conversations and campaigns.
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
    await seedContacts(db, workspace.id);

    console.log(`Seeded demo workspace "/w/${DEMO_SLUG}" with users (password: ${DEMO_PASSWORD}):`);
    for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
  } finally {
    await db.$disconnect();
  }
}

const FIRST = ["Aarav", "Ana", "Chen", "Fatima", "Kofi", "Lena", "Mateo", "Noor", "Priya", "Sam", "Yuki", "Zara"];
const LAST = ["Ahmed", "Costa", "Diaz", "Khan", "Mensah", "Novak", "Okafor", "Rao", "Sato", "Silva", "Smith", "Wang"];
const CITIES = ["Delhi", "Mumbai", "Nairobi", "Lagos", "Dubai", "London", "São Paulo", "Singapore"];

/** 200 demo contacts with tags, a list, a custom field and a segment. Skipped if contacts already exist. */
async function seedContacts(db: InstanceType<typeof PrismaClient>, workspaceId: string) {
  if ((await db.contact.count({ where: { workspaceId } })) > 0) return;
  const city = await db.customFieldDefinition.create({
    data: { workspaceId, key: "city", label: "City", type: "TEXT" },
  });
  const [customer, vip, lead] = await Promise.all(
    [
      { name: "Customer", color: "green" },
      { name: "VIP", color: "purple" },
      { name: "Lead", color: "blue" },
    ].map((t) => db.tag.create({ data: { workspaceId, ...t } })),
  );
  const list = await db.contactList.create({
    data: { workspaceId, name: "Demo event attendees", description: "Demo data" },
  });
  const optIns = ["OPTED_IN", "OPTED_IN", "OPTED_IN", "UNKNOWN", "OPTED_OUT"] as const;
  const now = Date.now();
  const contacts = Array.from({ length: 200 }, (_, i) => {
    const phone = `+9199${String(10000000 + i)}`;
    const optInStatus = optIns[i % optIns.length]!;
    return {
      workspaceId,
      phoneNumber: phone,
      normalizedPhoneNumber: phone,
      firstName: FIRST[i % FIRST.length]!,
      lastName: LAST[(i * 7) % LAST.length]!,
      email: i % 3 === 0 ? `demo${i}@example.com` : null,
      company: i % 4 === 0 ? "Demo Co" : null,
      optInStatus,
      optInSource: optInStatus === "OPTED_IN" ? "Demo data" : null,
      optInAt: optInStatus === "OPTED_IN" ? new Date(now - i * 3_600_000) : null,
      optedOutAt: optInStatus === "OPTED_OUT" ? new Date(now - i * 3_600_000) : null,
      customFields: { [city.key]: CITIES[i % CITIES.length]! },
      source: "IMPORT" as const,
      createdAt: new Date(now - i * 6 * 3_600_000),
    };
  });
  await db.contact.createMany({ data: contacts });
  const ids = (
    await db.contact.findMany({ where: { workspaceId }, select: { id: true }, orderBy: { createdAt: "desc" } })
  ).map((c) => c.id);
  await db.contactTag.createMany({
    data: ids.flatMap((contactId, i) => [
      ...(i % 2 === 0
        ? [{ workspaceId, contactId, tagId: customer!.id }]
        : [{ workspaceId, contactId, tagId: lead!.id }]),
      ...(i % 10 === 0 ? [{ workspaceId, contactId, tagId: vip!.id }] : []),
    ]),
  });
  await db.contactListMember.createMany({
    data: ids.slice(0, 40).map((contactId) => ({ workspaceId, contactId, listId: list.id })),
  });
  await db.segment.create({
    data: {
      workspaceId,
      name: "Opted-in customers in Delhi",
      description: "Demo data",
      definition: {
        version: 1,
        match: "all",
        conditions: [
          { field: "tag", op: "has", value: customer!.id },
          { field: "custom", key: "city", op: "equals", value: "Delhi" },
          { field: "optInStatus", op: "is", value: "OPTED_IN" },
        ],
      },
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
