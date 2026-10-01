import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { isAppError } from "@/server/errors";
import { bulkAddTag, bulkDelete, bulkRemoveTag } from "@/server/contacts/bulk";
import { createCustomField } from "@/server/contacts/custom-fields";
import {
  addNote,
  createContact,
  deleteContact,
  deleteNote,
  getContact,
  listContacts,
  setOptInStatus,
  updateContact,
} from "@/server/contacts/service";
import { addTagToContact, createTag, ensureTagsByName } from "@/server/contacts/tags";
import type { ContactInput } from "@/lib/validation/contacts";
import { memberContext, ownerContext, testPhone } from "../support/factories";

const input = (overrides: Partial<ContactInput> = {}): ContactInput => ({
  phoneNumber: testPhone(),
  firstName: "Ana",
  lastName: "Gomez",
  email: null,
  company: null,
  country: null,
  optInStatus: "UNKNOWN",
  optInSource: null,
  customFields: {},
  ...overrides,
});

async function errorCode(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  return isAppError(e) ? e.code : e;
}

describe("contacts", () => {
  it("normalizes phone numbers and prevents duplicates entered in another format", async () => {
    const ctx = await ownerContext();
    const { id } = await createContact(ctx, input({ phoneNumber: "+91 98765 43210" }));
    const stored = await db.contact.findFirstOrThrow({ where: { id, workspaceId: ctx.workspaceId } });
    expect(stored.normalizedPhoneNumber).toBe("+919876543210");
    expect(stored.country).toBe("IN");

    const dup = await createContact(ctx, input({ phoneNumber: "0091-98765-43210" })).catch((e: unknown) => e);
    expect(isAppError(dup) && dup.code).toBe("CONFLICT");
    expect(isAppError(dup) && dup.details?.existingId).toBe(id);
  });

  it("uses the workspace default country for national numbers", async () => {
    const ctx = await ownerContext({ defaultCountry: "IN" });
    const { id } = await createContact(ctx, input({ phoneNumber: "98765 43210" }));
    const c = await getContact(ctx, id);
    expect(c.normalizedPhoneNumber).toBe("+919876543210");
  });

  it("allows the same phone number in two different workspaces", async () => {
    const a = await ownerContext();
    const b = await ownerContext();
    await createContact(a, input({ phoneNumber: "+919876543210" }));
    await expect(createContact(b, input({ phoneNumber: "+919876543210" }))).resolves.toBeTruthy();
  });

  it("validates custom fields against their definitions", async () => {
    const ctx = await ownerContext();
    await createCustomField(ctx, { key: "orders", label: "Orders", type: "NUMBER" });
    expect(await errorCode(createContact(ctx, input({ customFields: { orders: "many" } })))).toBe("VALIDATION");
    expect(await errorCode(createContact(ctx, input({ customFields: { unknown: "x" } })))).toBe("VALIDATION");
    const { id } = await createContact(ctx, input({ customFields: { orders: "1,200" } }));
    expect((await getContact(ctx, id)).customFields).toEqual({ orders: "1200" });
  });

  it("records opt-in and opt-out timestamps and audits changes", async () => {
    const ctx = await ownerContext();
    const { id } = await createContact(ctx, input({ optInStatus: "OPTED_IN" }));
    const created = await getContact(ctx, id);
    expect(created.optInAt).not.toBeNull();
    await setOptInStatus(ctx, id, "OPTED_OUT", null);
    const after = await getContact(ctx, id);
    expect(after.optInStatus).toBe("OPTED_OUT");
    expect(after.optedOutAt).not.toBeNull();
    expect(after.optInAt).toEqual(created.optInAt);
    const entry = await db.auditLog.findFirstOrThrow({
      where: { workspaceId: ctx.workspaceId, action: "contact.opt_in_changed" },
    });
    expect(entry.metadata).toEqual({ from: "OPTED_IN", to: "OPTED_OUT" });
  });

  it("paginates with a cursor without gaps or duplicates", async () => {
    const ctx = await ownerContext();
    await db.contact.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        workspaceId: ctx.workspaceId,
        phoneNumber: `+9198${String(20000000 + i)}`,
        normalizedPhoneNumber: `+9198${String(20000000 + i)}`,
        firstName: `Person ${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i % 7)), // repeated timestamps
      })),
    });
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listContacts(ctx, { filter: {}, cursor, limit: 50 });
      expect(page.total).toBe(120);
      for (const c of page.items) seen.add(c.id);
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen.size).toBe(120);
  });

  it("searches by name, email and phone digits", async () => {
    const ctx = await ownerContext();
    await createContact(ctx, input({ firstName: "Zelda", phoneNumber: "+919876500001", email: "z@example.com" }));
    await createContact(ctx, input({ firstName: "Mario", phoneNumber: "+919876500002" }));
    expect((await listContacts(ctx, { filter: { q: "zel" } })).total).toBe(1);
    expect((await listContacts(ctx, { filter: { q: "z@example" } })).total).toBe(1);
    expect((await listContacts(ctx, { filter: { q: "98765 00002" } })).total).toBe(1);
  });

  it("filters by tag and never returns other workspaces' contacts", async () => {
    const a = await ownerContext();
    const b = await ownerContext();
    const tag = await createTag(a, { name: "VIP", color: "gray" });
    const c1 = await createContact(a, input());
    await createContact(a, input());
    await createContact(b, input());
    await addTagToContact(a, c1.id, tag.id);
    expect((await listContacts(a, { filter: { tagId: tag.id } })).items.map((c) => c.id)).toEqual([c1.id]);
    expect((await listContacts(a, { filter: {} })).total).toBe(2);
    expect((await listContacts(b, { filter: { tagId: tag.id } })).total).toBe(0);
  });
});

describe("contact tenant isolation and permissions", () => {
  it("cannot read, update, delete or tag a contact from another workspace", async () => {
    const a = await ownerContext();
    const b = await ownerContext();
    const { id } = await createContact(a, input());
    const bTag = await createTag(b, { name: "B", color: "gray" });
    const aTag = await createTag(a, { name: "A", color: "gray" });
    expect(await errorCode(getContact(b, id))).toBe("NOT_FOUND");
    expect(await errorCode(updateContact(b, id, input()))).toBe("NOT_FOUND");
    expect(await errorCode(deleteContact(b, id))).toBe("NOT_FOUND");
    expect(await errorCode(addTagToContact(a, id, bTag.id))).toBe("NOT_FOUND");
    expect(await errorCode(addNote(b, id, "hi"))).toBe("NOT_FOUND");
    expect(await errorCode(bulkAddTag(a, { ids: [id] }, bTag.id))).toBe("NOT_FOUND");
    // Explicit ids from another workspace are silently out of scope.
    expect(await bulkAddTag(b, { ids: [id] }, bTag.id)).toBe(0);
    expect(await bulkDelete(b, { ids: [id] })).toBe(0);
    await expect(getContact(a, id)).resolves.toBeTruthy();
    void aTag;
  });

  it("enforces role permissions on the server", async () => {
    const owner = await ownerContext();
    const agent = await memberContext(owner, "AGENT");
    const analyst = await memberContext(owner, "ANALYST");
    const { id } = await createContact(agent, input());
    expect(await errorCode(createContact(analyst, input()))).toBe("FORBIDDEN");
    expect(await errorCode(updateContact(analyst, id, input()))).toBe("FORBIDDEN");
    expect(await errorCode(deleteContact(agent, id))).toBe("FORBIDDEN");
    expect(await errorCode(bulkDelete(agent, { ids: [id] }))).toBe("FORBIDDEN");
    expect(await errorCode(createCustomField(agent, { key: "x", label: "X", type: "TEXT" }))).toBe("FORBIDDEN");
    await expect(getContact(analyst, id)).resolves.toBeTruthy();
  });

  it("lets authors delete their own notes but not agents delete others' notes", async () => {
    const owner = await ownerContext();
    const agent = await memberContext(owner, "AGENT");
    const { id } = await createContact(owner, input());
    const ownerNote = await addNote(owner, id, "owner note");
    const agentNote = await addNote(agent, id, "agent note");
    expect(await errorCode(deleteNote(agent, ownerNote.id))).toBe("FORBIDDEN");
    await deleteNote(agent, agentNote.id);
    await deleteNote(owner, ownerNote.id);
    expect((await getContact(owner, id)).notes).toEqual([]);
  });
});

describe("bulk actions", () => {
  it("tags and untags every contact matching a filter, in this workspace only", async () => {
    const a = await ownerContext();
    const b = await ownerContext();
    const tag = await createTag(a, { name: "Bulk", color: "gray" });
    for (let i = 0; i < 5; i++) await createContact(a, input({ optInStatus: i < 3 ? "OPTED_IN" : "UNKNOWN" }));
    await createContact(b, input({ optInStatus: "OPTED_IN" }));
    expect(await bulkAddTag(a, { filter: { optInStatus: "OPTED_IN" } }, tag.id)).toBe(3);
    expect(await bulkAddTag(a, { filter: { optInStatus: "OPTED_IN" } }, tag.id)).toBe(0); // idempotent
    expect(await bulkRemoveTag(a, { filter: {} }, tag.id)).toBe(3);
  });

  it("deletes by filter without touching other workspaces and audits it", async () => {
    const a = await ownerContext();
    const b = await ownerContext();
    for (let i = 0; i < 4; i++) await createContact(a, input());
    await createContact(b, input());
    expect(await bulkDelete(a, { filter: {} })).toBe(4);
    expect(await db.contact.count({ where: { workspaceId: b.workspaceId } })).toBe(1);
    const entry = await db.auditLog.findFirstOrThrow({
      where: { workspaceId: a.workspaceId, action: "contacts.bulk_deleted" },
    });
    expect(entry.metadata).toMatchObject({ count: 4, selection: "filter" });
  });

  it("finds or creates tags by name case-insensitively", async () => {
    const ctx = await ownerContext();
    const existing = await createTag(ctx, { name: "Customer", color: "gray" });
    const map = await ensureTagsByName(ctx, ["customer", "New Tag", "new tag"]);
    expect(map.get("customer")).toBe(existing.id);
    expect(await db.tag.count({ where: { workspaceId: ctx.workspaceId } })).toBe(2);
  });
});
