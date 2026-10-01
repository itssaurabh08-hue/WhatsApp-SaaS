import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import type { ColumnTarget } from "@/lib/contacts/fields";
import type { ImportOptions } from "@/lib/validation/imports";
import { db } from "@/server/db/client";
import { isAppError } from "@/server/errors";
import { createCustomField } from "@/server/contacts/custom-fields";
import { exportContactsCsv } from "@/server/contacts/export";
import { createImportJob, importErrorsCsv, previewImport, runImport } from "@/server/contacts/imports";
import { createContactList } from "@/server/contacts/lists";
import { createContact, getContact } from "@/server/contacts/service";
import { createTag } from "@/server/contacts/tags";
import { memberContext, ownerContext } from "../support/factories";

const CSV = [
  "Name,Mobile,Email,Opt In,City,Tags",
  "Asha Rao,98765 11111,asha@example.com,yes,Delhi,VIP",
  "Ravi Kumar,+91 98765 22222,,no,Mumbai,",
  "Bad Phone,12345,,,,",
  "Dup Asha,+919876511111,,,,",
  "Existing Person,+91 98765 33333,new@example.com,yes,Pune,vip",
  "Bad Email,+91 98765 44444,not-an-email,,,",
].join("\n");

const mapping: ColumnTarget[] = ["fullName", "phoneNumber", "email", "optInStatus", "custom:city", "tags"];

const baseOptions = (o: Partial<ImportOptions> = {}): ImportOptions => ({
  defaultCountry: "IN",
  defaultOptInStatus: "UNKNOWN",
  optInSource: "Website form",
  duplicateStrategy: "update",
  tagIds: [],
  listId: null,
  ...o,
});

async function setup() {
  const ctx = await ownerContext();
  await createCustomField(ctx, { key: "city", label: "City", type: "TEXT" });
  // An existing contact who opted out earlier and has an extra custom field.
  await db.customFieldDefinition.create({
    data: { workspaceId: ctx.workspaceId, key: "tier", label: "Tier", type: "TEXT" },
  });
  const existing = await createContact(ctx, {
    phoneNumber: "+919876533333",
    firstName: "Old",
    lastName: "Name",
    email: null,
    company: null,
    country: null,
    optInStatus: "OPTED_OUT",
    optInSource: null,
    customFields: { tier: "gold" },
  });
  const job = await createImportJob(ctx, { name: "contacts.csv", size: CSV.length, text: CSV });
  return { ctx, job, existingId: existing.id };
}

async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  return isAppError(e) ? e.code : e;
}

describe("CSV import", () => {
  it("previews counts for new, existing, invalid and in-file duplicate rows", async () => {
    const { ctx, job } = await setup();
    const preview = await previewImport(ctx, job.id, mapping, baseOptions());
    expect(preview).toMatchObject({
      totalRows: 6,
      newCount: 2,
      existingCount: 1,
      invalidCount: 3,
      keptOptedOutCount: 1,
    });
    expect(preview.invalidSample.map((r) => r.rowNumber)).toEqual([4, 5, 7]);
    expect(preview.invalidSample[1]!.errors[0]).toBe("Duplicate of row 2 in this file");
    // Preview writes nothing.
    expect(await db.contact.count({ where: { workspaceId: ctx.workspaceId } })).toBe(1);
  });

  it("imports valid rows, updates existing ones, keeps opt-outs and records failures", async () => {
    const { ctx, job, existingId } = await setup();
    const list = (await createContactList(ctx, { name: "Imported", description: null }))!;
    const extra = await createTag(ctx, { name: "Spring import", color: "green" });
    const result = await runImport(ctx, job.id, mapping, baseOptions({ tagIds: [extra.id], listId: list.id }));
    expect(result).toEqual({ created: 2, updated: 1, skipped: 0, failed: 3 });

    const asha = await db.contact.findFirstOrThrow({
      where: { workspaceId: ctx.workspaceId, normalizedPhoneNumber: "+919876511111" },
      include: { tags: { include: { tag: true } }, lists: true },
    });
    expect(asha).toMatchObject({
      firstName: "Asha",
      lastName: "Rao",
      optInStatus: "OPTED_IN",
      optInSource: "Website form",
      source: "IMPORT",
    });
    expect(asha.optInAt).not.toBeNull();
    expect(asha.customFields).toEqual({ city: "Delhi" });
    expect(asha.tags.map((t) => t.tag.name).sort()).toEqual(["Spring import", "VIP"]);
    expect(asha.lists).toHaveLength(1);

    const ravi = await db.contact.findFirstOrThrow({
      where: { workspaceId: ctx.workspaceId, normalizedPhoneNumber: "+919876522222" },
    });
    expect(ravi.optInStatus).toBe("OPTED_OUT");
    expect(ravi.optedOutAt).not.toBeNull();

    const existing = await getContact(ctx, existingId);
    expect(existing).toMatchObject({
      firstName: "Existing",
      lastName: "Person",
      email: "new@example.com",
      optInStatus: "OPTED_OUT",
    });
    expect(existing.customFields).toEqual({ tier: "gold", city: "Pune" }); // merged, not replaced
    expect(existing.tags.map((t) => t.tag.name).sort()).toEqual(["Spring import", "VIP"]); // "vip" matched existing tag "VIP"
    expect(await db.tag.count({ where: { workspaceId: ctx.workspaceId } })).toBe(2);

    const stored = await db.importJob.findFirstOrThrow({ where: { id: job.id, workspaceId: ctx.workspaceId } });
    expect(stored).toMatchObject({
      status: "COMPLETED",
      csvContent: null,
      createdCount: 2,
      updatedCount: 1,
      failedCount: 3,
    });
    expect(await db.auditLog.count({ where: { workspaceId: ctx.workspaceId, action: "contacts.imported" } })).toBe(1);
  });

  it("cannot run the same import twice", async () => {
    const { ctx, job } = await setup();
    await runImport(ctx, job.id, mapping, baseOptions());
    expect(await code(runImport(ctx, job.id, mapping, baseOptions()))).toBe("CONFLICT");
    expect(await db.contact.count({ where: { workspaceId: ctx.workspaceId } })).toBe(3);
  });

  it("skips existing contacts when asked", async () => {
    const { ctx, job, existingId } = await setup();
    const result = await runImport(ctx, job.id, mapping, baseOptions({ duplicateStrategy: "skip" }));
    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 1 });
    expect((await getContact(ctx, existingId)).firstName).toBe("Old");
  });

  it("produces a downloadable error report with the original columns", async () => {
    const { ctx, job } = await setup();
    await runImport(ctx, job.id, mapping, baseOptions());
    const { fileName, csv } = await importErrorsCsv(ctx, job.id);
    expect(fileName).toBe("contacts-errors.csv");
    const parsed = parseCsv(csv);
    expect(parsed.ok && parsed.data.headers).toEqual([
      "Row",
      "Error",
      "Name",
      "Mobile",
      "Email",
      "Opt In",
      "City",
      "Tags",
    ]);
    expect(parsed.ok && parsed.data.rows.map((r) => r[0])).toEqual(["4", "5", "7"]);
    expect(parsed.ok && parsed.data.rows[2]![1]).toMatch(/Email "not-an-email" is not valid/);
  });

  it("rejects bad mappings, other workspaces and roles without import permission", async () => {
    const { ctx, job } = await setup();
    const other = await ownerContext();
    const analyst = await memberContext(ctx, "ANALYST");
    expect(await code(previewImport(ctx, job.id, ["phoneNumber"], baseOptions()))).toBe("VALIDATION");
    expect(await code(previewImport(other, job.id, mapping, baseOptions()))).toBe("NOT_FOUND");
    expect(await code(runImport(other, job.id, mapping, baseOptions()))).toBe("NOT_FOUND");
    expect(await code(previewImport(analyst, job.id, mapping, baseOptions()))).toBe("FORBIDDEN");
    const otherTag = await createTag(other, { name: "x", color: "gray" });
    expect(await code(runImport(ctx, job.id, mapping, baseOptions({ tagIds: [otherTag.id] })))).toBe("VALIDATION");
  });

  it("rejects unusable uploads with a friendly message", async () => {
    const ctx = await ownerContext();
    expect(await code(createImportJob(ctx, { name: "x.csv", size: 0, text: "" }))).toBe("VALIDATION");
    expect(await code(createImportJob(ctx, { name: "x.xlsx", size: 10, text: "a,b\n1,2" }))).toBe("VALIDATION");
    expect(await code(createImportJob(ctx, { name: "x.csv", size: 6 * 1024 * 1024, text: "a\n1" }))).toBe("VALIDATION");
  });

  it("imports 20,000 rows within a reasonable time", async () => {
    const ctx = await ownerContext();
    const lines = ["phone,name"];
    for (let i = 0; i < 20000; i++) lines.push(`+9197${String(10000000 + i)},Person ${i}`);
    const text = lines.join("\n");
    const job = await createImportJob(ctx, { name: "big.csv", size: text.length, text });
    const started = Date.now();
    const result = await runImport(ctx, job.id, ["phoneNumber", "fullName"], baseOptions());
    const elapsed = Date.now() - started;
    expect(result.created).toBe(20000);
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);
});

describe("CSV export", () => {
  async function readAll(stream: ReadableStream<Uint8Array>) {
    return new Response(stream).text();
  }

  it("exports only this workspace's contacts with custom fields, neutralizing formulas", async () => {
    const ctx = await ownerContext();
    const other = await ownerContext();
    await createCustomField(ctx, { key: "city", label: "City", type: "TEXT" });
    const base = {
      lastName: null,
      email: null,
      company: null,
      country: null,
      optInStatus: "OPTED_IN" as const,
      optInSource: null,
    };
    await createContact(ctx, {
      ...base,
      phoneNumber: "+919876500011",
      firstName: "=cmd()",
      customFields: { city: "Delhi" },
    });
    await createContact(other, { ...base, phoneNumber: "+919876500012", firstName: "Secret", customFields: {} });
    const text = await readAll(await exportContactsCsv(ctx, {}));
    const parsed = parseCsv(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.headers.at(-1)).toBe("city");
    expect(parsed.data.rows).toHaveLength(1);
    expect(parsed.data.rows[0]![0]).toBe("+919876500011");
    expect(parsed.data.rows[0]![1]).toBe("'=cmd()");
    expect(parsed.data.rows[0]!.at(-1)).toBe("Delhi");
    expect(text).not.toContain("Secret");
    expect(await db.auditLog.count({ where: { workspaceId: ctx.workspaceId, action: "contacts.exported" } })).toBe(1);
  });

  it("requires export permission", async () => {
    const ctx = await ownerContext();
    const agent = await memberContext(ctx, "AGENT");
    expect(await code(exportContactsCsv(agent, {}))).toBe("FORBIDDEN");
  });
});
