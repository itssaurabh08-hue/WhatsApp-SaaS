import { describe, expect, it } from "vitest";
import { listCountries, normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("normalizes international formats to E.164", () => {
    for (const input of ["+91 98123 45678", "+91-9812345678", "(+91) 98123-45678", "0091 98123 45678"]) {
      expect(normalizePhone(input)).toEqual({ ok: true, e164: "+919812345678", country: "IN" });
    }
  });

  it("uses the default country for national numbers", () => {
    expect(normalizePhone("098123 45678", "IN")).toMatchObject({ ok: true, e164: "+919812345678" });
    expect(normalizePhone("(415) 555-2671", "US")).toMatchObject({ ok: true, e164: "+14155552671" });
  });

  it("requires a country code when there is no default", () => {
    const r = normalizePhone("9812345678");
    expect(r.ok).toBe(false);
  });

  it("rejects invalid, empty and absurd input", () => {
    expect(normalizePhone("+91 123").ok).toBe(false);
    expect(normalizePhone("   ").ok).toBe(false);
    expect(normalizePhone("not a number", "IN").ok).toBe(false);
    expect(normalizePhone("+".padEnd(60, "1")).ok).toBe(false);
  });

  it("ignores an unsupported default country", () => {
    expect(normalizePhone("9812345678", "XX").ok).toBe(false);
  });

  it("lists countries with calling codes", () => {
    const india = listCountries().find((c) => c.code === "IN");
    expect(india).toMatchObject({ name: "India", callingCode: "91" });
  });
});
