import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { bulkAddToList } from "@/server/contacts/bulk";
import { createCustomField } from "@/server/contacts/custom-fields";
import { createContactList } from "@/server/contacts/lists";
import { countSegment, createSegment } from "@/server/contacts/segments";
import { createContact, listContacts } from "@/server/contacts/service";
import { addTagToContact, createTag } from "@/server/contacts/tags";
import { isAppError } from "@/server/errors";
import type { SegmentDefinition } from "@/lib/segments";
import { memberContext, ownerContext, testPhone } from "../support/factories";

async function setup() {
  const ctx = await ownerContext();
  await createCustomField(ctx, { key: "city", label: "City", type: "TEXT" });
  const customer = await createTag(ctx, { name: "Customer", color: "gray" });
  const list = (await createContactList(ctx, { name: "Event", description: null }))!;
  const make = async (
    firstName: string,
    city: string | null,
    tagged: boolean,
    optIn: "OPTED_IN" | "UNKNOWN",
    email: string | null = null,
  ) => {
    const { id } = await createContact(ctx, {
      phoneNumber: testPhone(),
      firstName,
      lastName: null,
      email,
      company: null,
      country: null,
      optInStatus: optIn,
      optInSource: null,
      customFields: city ? { city } : {},
    });
    if (tagged) await addTagToContact(ctx, id, customer.id);
    return id;
  };
  const delhiCustomer = await make("Asha", "Delhi", true, "OPTED_IN", "asha@example.com");
  const mumbaiCustomer = await make("Ravi", "Mumbai", true, "UNKNOWN");
  const delhiLead = await make("Neha", "Delhi", false, "OPTED_IN");
  const noCity = await make("Omar", null, false, "UNKNOWN");
  await bulkAddToList(ctx, { ids: [mumbaiCustomer, noCity] }, list.id);
  return { ctx, customer, list, ids: { delhiCustomer, mumbaiCustomer, delhiLead, noCity } };
}

const def = (match: "all" | "any", conditions: SegmentDefinition["conditions"]): SegmentDefinition => ({
  version: 1,
  match,
  conditions,
});

describe("segments", () => {
  it("combines tag AND custom field conditions (Tag = Customer AND City = Delhi)", async () => {
    const { ctx, customer } = await setup();
    const d = def("all", [
      { field: "tag", op: "has", value: customer.id },
      { field: "custom", key: "city", op: "equals", value: "Delhi" },
    ]);
    expect(await countSegment(ctx, d)).toBe(1);
  });

  it("supports OR matching", async () => {
    const { ctx, customer } = await setup();
    const d = def("any", [
      { field: "tag", op: "has", value: customer.id },
      { field: "custom", key: "city", op: "equals", value: "Delhi" },
    ]);
    expect(await countSegment(ctx, d)).toBe(3);
  });

  it("handles negative and empty conditions, including missing custom keys", async () => {
    const { ctx, customer, list } = await setup();
    expect(await countSegment(ctx, def("all", [{ field: "tag", op: "not_has", value: customer.id }]))).toBe(2);
    expect(await countSegment(ctx, def("all", [{ field: "custom", key: "city", op: "is_empty" }]))).toBe(1);
    expect(await countSegment(ctx, def("all", [{ field: "custom", key: "city", op: "is_not_empty" }]))).toBe(3);
    expect(
      await countSegment(ctx, def("all", [{ field: "custom", key: "city", op: "not_equals", value: "Delhi" }])),
    ).toBe(2);
    expect(await countSegment(ctx, def("all", [{ field: "custom", key: "city", op: "contains", value: "umb" }]))).toBe(
      1,
    );
    expect(await countSegment(ctx, def("all", [{ field: "list", op: "in", value: list.id }]))).toBe(2);
    expect(await countSegment(ctx, def("all", [{ field: "list", op: "not_in", value: list.id }]))).toBe(2);
    expect(await countSegment(ctx, def("all", [{ field: "email", op: "is_empty" }]))).toBe(3);
    expect(await countSegment(ctx, def("all", [{ field: "firstName", op: "equals", value: "asha" }]))).toBe(1);
  });

  it("filters by opt-in status and dates", async () => {
    const { ctx, ids } = await setup();
    expect(await countSegment(ctx, def("all", [{ field: "optInStatus", op: "is", value: "OPTED_IN" }]))).toBe(2);
    await db.contact.updateMany({
      where: { id: ids.noCity, workspaceId: ctx.workspaceId },
      data: { createdAt: new Date("2020-01-01") },
    });
    expect(await countSegment(ctx, def("all", [{ field: "createdAt", op: "in_last_days", value: "30" }]))).toBe(3);
    expect(await countSegment(ctx, def("all", [{ field: "createdAt", op: "before", value: "2021-01-01" }]))).toBe(1);
    expect(await countSegment(ctx, def("all", [{ field: "lastMessageAt", op: "never", value: "" }]))).toBe(4);
  });

  it("is used as a contacts list filter and stays inside the workspace", async () => {
    const { ctx, customer } = await setup();
    const other = await ownerContext();
    await createContact(other, {
      phoneNumber: testPhone(),
      firstName: "X",
      lastName: null,
      email: null,
      company: null,
      country: null,
      optInStatus: "OPTED_IN",
      optInSource: null,
      customFields: {},
    });
    const segment = (await createSegment(ctx, {
      name: "Opted in",
      description: null,
      definition: def("all", [{ field: "optInStatus", op: "is", value: "OPTED_IN" }]),
    }))!;
    expect((await listContacts(ctx, { filter: { segmentId: segment.id } })).total).toBe(2);
    // Another workspace cannot use this segment id.
    const err = await listContacts(other, { filter: { segmentId: segment.id } }).catch((e: unknown) => e);
    expect(isAppError(err) && err.code).toBe("NOT_FOUND");
    void customer;
  });

  it("only lets roles with segments:manage create segments", async () => {
    const { ctx } = await setup();
    const agent = await memberContext(ctx, "AGENT");
    const err = await createSegment(agent, {
      name: "x",
      description: null,
      definition: def("all", [{ field: "optInStatus", op: "is", value: "OPTED_IN" }]),
    }).catch((e: unknown) => e);
    expect(isAppError(err) && err.code).toBe("FORBIDDEN");
  });
});
