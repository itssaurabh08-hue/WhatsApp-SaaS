import { describe, expect, it } from "vitest";
import { coerceCustomValue, optInTransition } from "@/lib/contacts/custom-values";
import { parseOptIn, splitFullName, suggestMapping } from "@/lib/contacts/fields";

describe("suggestMapping", () => {
  it("maps common header names, each field at most once", () => {
    expect(suggestMapping(["Name", "Mobile", "E-mail", "Company Name", "Phone", "City"], ["city"])).toEqual([
      "fullName",
      "phoneNumber",
      "email",
      "company",
      "",
      "custom:city",
    ]);
  });

  it("leaves unknown headers unmapped", () => {
    expect(suggestMapping(["Favourite colour"])).toEqual([""]);
  });
});

describe("parseOptIn", () => {
  it("understands common yes/no spellings", () => {
    expect(parseOptIn("Yes")).toBe("OPTED_IN");
    expect(parseOptIn("opted-in")).toBe("OPTED_IN");
    expect(parseOptIn("0")).toBe("OPTED_OUT");
    expect(parseOptIn("Unsubscribed")).toBe("OPTED_OUT");
    expect(parseOptIn("")).toBe("UNKNOWN");
    expect(parseOptIn("maybe")).toBeNull();
  });
});

describe("splitFullName", () => {
  it("splits on the last space", () => {
    expect(splitFullName("Mary Ann Smith")).toEqual({ firstName: "Mary Ann", lastName: "Smith" });
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: null });
    expect(splitFullName("  ")).toEqual({ firstName: null, lastName: null });
  });
});

describe("coerceCustomValue", () => {
  it("normalizes typed values to strings", () => {
    expect(coerceCustomValue("NUMBER", "1,250.5")).toEqual({ ok: true, value: "1250.5" });
    expect(coerceCustomValue("BOOLEAN", "Yes")).toEqual({ ok: true, value: "true" });
    expect(coerceCustomValue("DATE", "2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(coerceCustomValue("TEXT", "  hi ")).toEqual({ ok: true, value: "hi" });
    expect(coerceCustomValue("TEXT", "")).toEqual({ ok: true, value: null });
  });

  it("rejects invalid values", () => {
    expect(coerceCustomValue("NUMBER", "abc").ok).toBe(false);
    expect(coerceCustomValue("DATE", "2026-02-30").ok).toBe(false);
    expect(coerceCustomValue("DATE", "28/02/2026").ok).toBe(false);
    expect(coerceCustomValue("BOOLEAN", "maybe").ok).toBe(false);
  });
});

describe("optInTransition", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  it("stamps opt-in and opt-out times and leaves history intact", () => {
    expect(optInTransition("UNKNOWN", "OPTED_IN", now)).toEqual({ optInStatus: "OPTED_IN", optInAt: now });
    expect(optInTransition("OPTED_IN", "OPTED_OUT", now)).toEqual({ optInStatus: "OPTED_OUT", optedOutAt: now });
    expect(optInTransition("OPTED_OUT", "UNKNOWN", now)).toEqual({ optInStatus: "UNKNOWN" });
    expect(optInTransition("OPTED_IN", "OPTED_IN", now)).toEqual({});
  });
});
