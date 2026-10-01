import { describe, expect, it } from "vitest";
import { assignableRoles, PERMISSIONS, roleHasPermission } from "@/lib/permissions";

describe("permissions matrix", () => {
  it("grants OWNER every permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("OWNER", p)).toBe(true);
  });

  it("denies ADMIN ownership and billing-sensitive operations only", () => {
    expect(roleHasPermission("ADMIN", "billing:manage")).toBe(false);
    expect(roleHasPermission("ADMIN", "workspace:delete")).toBe(false);
    expect(roleHasPermission("ADMIN", "workspace:transfer_ownership")).toBe(false);
    expect(roleHasPermission("ADMIN", "campaigns:send")).toBe(true);
    expect(roleHasPermission("ADMIN", "team:invite")).toBe(true);
  });

  it("limits AGENT to inbox and contacts", () => {
    expect(roleHasPermission("AGENT", "inbox:reply")).toBe(true);
    expect(roleHasPermission("AGENT", "contacts:write")).toBe(true);
    expect(roleHasPermission("AGENT", "campaigns:send")).toBe(false);
    expect(roleHasPermission("AGENT", "analytics:read")).toBe(false);
    expect(roleHasPermission("AGENT", "workspace:update")).toBe(false);
    expect(roleHasPermission("AGENT", "api_keys:manage")).toBe(false);
  });

  it("gives ANALYST read-only analytics access", () => {
    expect(roleHasPermission("ANALYST", "analytics:read")).toBe(true);
    expect(roleHasPermission("ANALYST", "contacts:export")).toBe(true);
    expect(roleHasPermission("ANALYST", "inbox:reply")).toBe(false);
    expect(roleHasPermission("ANALYST", "contacts:write")).toBe(false);
    expect(roleHasPermission("ANALYST", "campaigns:manage")).toBe(false);
  });

  it("only lets owners assign the OWNER role", () => {
    expect(assignableRoles("OWNER")).toContain("OWNER");
    expect(assignableRoles("ADMIN")).not.toContain("OWNER");
    expect(assignableRoles("AGENT")).toEqual([]);
    expect(assignableRoles("ANALYST")).toEqual([]);
  });
});
