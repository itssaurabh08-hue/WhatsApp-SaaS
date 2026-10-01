import { describe, expect, it } from "vitest";
import type { ColumnTarget } from "@/lib/contacts/fields";
import { validateRows } from "@/server/contacts/imports";

const options = {
  defaultCountry: "IN",
  defaultOptInStatus: "UNKNOWN" as const,
  optInSource: null,
  duplicateStrategy: "update" as const,
  tagIds: [],
  listId: null,
};

describe("validateRows", () => {
  const headers = ["Name", "Mobile", "Email", "Opt in", "City", "Tags"];
  const mapping: ColumnTarget[] = ["fullName", "phoneNumber", "email", "optInStatus", "custom:city", "tags"];
  const types = new Map([["city", "TEXT" as const]]);

  it("accepts good rows and normalizes them", () => {
    const { valid, invalid } = validateRows(
      headers,
      [["Ana Gomez", "98123 45678", "ANA@x.com", "yes", "Delhi", "VIP, Customer"]],
      mapping,
      options,
      types,
    );
    expect(invalid).toEqual([]);
    expect(valid[0]).toMatchObject({
      rowNumber: 2,
      e164: "+919812345678",
      firstName: "Ana",
      lastName: "Gomez",
      email: "ana@x.com",
      optInStatus: "OPTED_IN",
      customFields: { city: "Delhi" },
      tagNames: ["VIP", "Customer"],
    });
  });

  it("reports every problem in a row with its row number", () => {
    const { valid, invalid } = validateRows(
      headers,
      [["X", "123", "bad-email", "maybe", "", ""]],
      mapping,
      options,
      types,
    );
    expect(valid).toEqual([]);
    expect(invalid[0]!.rowNumber).toBe(2);
    expect(invalid[0]!.errors).toHaveLength(3);
    expect(invalid[0]!.data).toMatchObject({ Name: "X", Mobile: "123" });
  });

  it("flags duplicates within the file, keeping the first occurrence", () => {
    const rows = [
      ["A", "+919812345678", "", "", "", ""],
      ["B", "098123 45678", "", "", "", ""],
    ];
    const { valid, invalid } = validateRows(headers, rows, mapping, options, types);
    expect(valid.map((v) => v.rowNumber)).toEqual([2]);
    expect(invalid[0]!.errors).toEqual(["Duplicate of row 2 in this file"]);
  });

  it("uses the default opt-in when no column is mapped", () => {
    const m: ColumnTarget[] = ["fullName", "phoneNumber", "", "", "", ""];
    const { valid } = validateRows(
      headers,
      [["A", "+919812345678", "", "", "", ""]],
      m,
      { ...options, defaultOptInStatus: "OPTED_IN" },
      types,
    );
    expect(valid[0]!.optInStatus).toBe("OPTED_IN");
  });

  it("rejects custom field columns that do not exist", () => {
    const m: ColumnTarget[] = ["fullName", "phoneNumber", "", "", "custom:missing", ""];
    const { invalid } = validateRows(headers, [["A", "+919812345678", "", "", "x", ""]], m, options, types);
    expect(invalid[0]!.errors[0]).toMatch(/does not exist/);
  });
});
