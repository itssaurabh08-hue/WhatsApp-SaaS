import { describe, expect, it } from "vitest";
import { assertTenantScoped, TenantScopeError } from "@/server/db/tenant-guard";

const M = "WorkspaceInvite";

describe("tenant guard", () => {
  it("ignores non-tenant models", () => {
    expect(() => assertTenantScoped("User", "findMany", {})).not.toThrow();
  });

  it("rejects reads, updates and deletes without workspaceId", () => {
    for (const op of ["findMany", "findFirst", "findUnique", "update", "updateMany", "delete", "deleteMany", "count"]) {
      expect(() => assertTenantScoped(M, op, { where: { id: "x" } })).toThrow(TenantScopeError);
    }
    expect(() => assertTenantScoped(M, "findMany", undefined)).toThrow(TenantScopeError);
  });

  it("rejects an explicit null workspaceId", () => {
    expect(() => assertTenantScoped(M, "findMany", { where: { workspaceId: null } })).toThrow(TenantScopeError);
  });

  it("accepts a top-level workspaceId filter", () => {
    expect(() => assertTenantScoped(M, "findMany", { where: { workspaceId: "ws1", email: "a" } })).not.toThrow();
  });

  it("accepts compound unique keys that include workspaceId", () => {
    expect(() =>
      assertTenantScoped(M, "findUnique", { where: { workspaceId_email: { workspaceId: "ws1", email: "a" } } }),
    ).not.toThrow();
  });

  it("requires workspaceId on create and createMany", () => {
    expect(() => assertTenantScoped(M, "create", { data: { email: "a" } })).toThrow(TenantScopeError);
    expect(() => assertTenantScoped(M, "create", { data: { workspaceId: "ws1" } })).not.toThrow();
    expect(() => assertTenantScoped(M, "create", { data: { workspace: { connect: { id: "ws1" } } } })).not.toThrow();
    expect(() => assertTenantScoped(M, "createMany", { data: [{ workspaceId: "ws1" }, { email: "no-ws" }] })).toThrow(
      TenantScopeError,
    );
  });
});
