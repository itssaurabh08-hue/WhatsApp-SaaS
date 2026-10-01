import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { slugify } from "@/lib/slug";
import { loginSchema, resetPasswordSchema, signupSchema } from "@/lib/validation/auth";
import { createWorkspaceSchema, timezoneSchema, workspaceSettingsSchema } from "@/lib/validation/workspace";

describe("auth validation", () => {
  it("normalizes email to lowercase and trims", () => {
    const r = signupSchema.parse({ name: " Ana ", email: "  Ana@Example.COM ", password: "a-long-password" });
    expect(r.email).toBe("ana@example.com");
    expect(r.name).toBe("Ana");
  });

  it("enforces password length on signup but not on login", () => {
    expect(signupSchema.safeParse({ name: "A", email: "a@b.co", password: "short" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(true);
  });

  it("requires matching password confirmation", () => {
    const r = resetPasswordSchema.safeParse({
      token: "t",
      password: "a-long-password",
      confirmPassword: "different-pass",
    });
    expect(r.success).toBe(false);
  });
});

describe("workspace validation", () => {
  it("accepts valid slugs and rejects reserved or malformed ones", () => {
    expect(createWorkspaceSchema.safeParse({ name: "Acme", slug: "acme-inc" }).success).toBe(true);
    expect(createWorkspaceSchema.safeParse({ name: "Acme", slug: "admin" }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "Acme", slug: "-bad" }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "Acme", slug: "ab" }).success).toBe(false);
    expect(createWorkspaceSchema.parse({ name: "Acme", slug: "" }).slug).toBeUndefined();
  });

  it("validates IANA timezones", () => {
    expect(timezoneSchema.safeParse("Asia/Kolkata").success).toBe(true);
    expect(timezoneSchema.safeParse("Mars/Base").success).toBe(false);
  });

  it("only accepts https logo URLs", () => {
    const base = { name: "Acme", businessName: "Acme", timezone: "UTC", currency: "USD", defaultCountry: "" };
    expect(workspaceSettingsSchema.safeParse({ ...base, logoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(workspaceSettingsSchema.safeParse({ ...base, logoUrl: "http://x.com/a.png" }).success).toBe(false);
    expect(workspaceSettingsSchema.parse({ ...base, logoUrl: "" }).logoUrl).toBeNull();
  });
});

describe("helpers", () => {
  it("slugifies names", () => {
    expect(slugify("Café Délice & Co.")).toBe("cafe-delice-co");
    expect(slugify("  ---  ")).toBe("");
  });

  it("only allows same-origin relative redirects", () => {
    expect(safeRedirectPath("/w/acme", "/")).toBe("/w/acme");
    expect(safeRedirectPath("//evil.com", "/")).toBe("/");
    expect(safeRedirectPath("/\\evil.com", "/")).toBe("/");
    expect(safeRedirectPath("https://evil.com", "/")).toBe("/");
    expect(safeRedirectPath(undefined, "/fallback")).toBe("/fallback");
  });
});

describe("timezones", async () => {
  const { listTimezones } = await import("@/lib/timezones");
  it("lists modern IANA names, UTC first, and includes a stored value", () => {
    const zones = listTimezones("Etc/GMT+5");
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Asia/Kolkata");
    expect(zones).not.toContain("Asia/Calcutta");
    expect(zones).toContain("Etc/GMT+5");
    expect(new Set(zones).size).toBe(zones.length);
  });
});
