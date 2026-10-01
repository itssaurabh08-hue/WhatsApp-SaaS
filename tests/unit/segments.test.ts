import { describe, expect, it } from "vitest";
import { segmentDefinitionSchema } from "@/lib/segments";

describe("segment definition schema", () => {
  it("accepts a valid AND definition", () => {
    const r = segmentDefinitionSchema.safeParse({
      match: "all",
      conditions: [
        { field: "tag", op: "has", value: "tag1" },
        { field: "custom", key: "city", op: "equals", value: "Delhi" },
        { field: "createdAt", op: "in_last_days", value: "30" },
        { field: "email", op: "is_not_empty" },
        { field: "lastMessageAt", op: "never" },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.version).toBe(1);
  });

  it("requires values for value operators", () => {
    expect(
      segmentDefinitionSchema.safeParse({ match: "any", conditions: [{ field: "firstName", op: "equals", value: "" }] })
        .success,
    ).toBe(false);
    expect(
      segmentDefinitionSchema.safeParse({
        match: "any",
        conditions: [{ field: "createdAt", op: "before", value: "nope" }],
      }).success,
    ).toBe(false);
    expect(
      segmentDefinitionSchema.safeParse({
        match: "any",
        conditions: [{ field: "createdAt", op: "in_last_days", value: "-3" }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields, empty and oversized condition lists", () => {
    expect(
      segmentDefinitionSchema.safeParse({ match: "all", conditions: [{ field: "password", op: "equals", value: "x" }] })
        .success,
    ).toBe(false);
    expect(segmentDefinitionSchema.safeParse({ match: "all", conditions: [] }).success).toBe(false);
    const many = Array.from({ length: 21 }, () => ({ field: "optInStatus", op: "is", value: "OPTED_IN" }));
    expect(segmentDefinitionSchema.safeParse({ match: "all", conditions: many }).success).toBe(false);
  });
});
