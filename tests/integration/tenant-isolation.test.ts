import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { TenantScopeError } from "@/server/db/tenant-guard";
import { isAppError } from "@/server/errors";
import { loadTenantContext } from "@/server/authz/tenant";
import { listMembers } from "@/server/workspace/members";
import {
  createWorkspace,
  getWorkspaceOverview,
  updateBusinessDetails,
  updateWorkspaceSettings,
} from "@/server/workspace/service";
import { addMember, createUser, createWorkspaceWithMember, tenantContextFor } from "../support/factories";

describe("workspace creation", () => {
  it("makes the creator the OWNER and audits it", async () => {
    const user = await createUser();
    const ws = await createWorkspace(user.id, { name: "Acme Inc" });
    expect(ws.slug).toBe("acme-inc");
    const member = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: ws.id } });
    expect(member).toMatchObject({ userId: user.id, role: "OWNER" });
    expect(await db.auditLog.count({ where: { workspaceId: ws.id, action: "workspace.created" } })).toBe(1);
  });

  it("generates a different slug when the name is taken", async () => {
    const user = await createUser();
    const a = await createWorkspace(user.id, { name: "Acme" });
    const b = await createWorkspace(user.id, { name: "Acme" });
    expect(a.slug).not.toEqual(b.slug);
  });

  it("rejects an explicitly requested slug that is taken", async () => {
    const user = await createUser();
    await createWorkspace(user.id, { name: "One", slug: "taken-slug" });
    const error = await createWorkspace(user.id, { name: "Two", slug: "taken-slug" }).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("CONFLICT");
  });
});

describe("tenant isolation", () => {
  it("does not resolve a workspace for a user who is not a member", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const wsA = await createWorkspaceWithMember(alice.id);
    const wsB = await createWorkspaceWithMember(bob.id);

    expect(await loadTenantContext(alice.id, wsA.slug)).not.toBeNull();
    expect(await loadTenantContext(alice.id, wsB.slug)).toBeNull();
    expect(await loadTenantContext(bob.id, wsA.slug)).toBeNull();
  });

  it("treats a missing workspace the same as a forbidden one", async () => {
    const alice = await createUser();
    expect(await loadTenantContext(alice.id, "does-not-exist")).toBeNull();
  });

  it("only lists members of the caller's workspace", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const wsA = await createWorkspaceWithMember(alice.id);
    await createWorkspaceWithMember(bob.id);
    const ctx = await tenantContextFor(alice.id, wsA.slug);
    const members = await listMembers(ctx);
    expect(members.map((m) => m.user.id)).toEqual([alice.id]);
  });

  it("only shows audit entries for the caller's workspace", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const wsA = await createWorkspace(alice.id, { name: "Alpha" });
    await createWorkspace(bob.id, { name: "Beta" });
    const ctx = await tenantContextFor(alice.id, wsA.slug);
    const overview = await getWorkspaceOverview(ctx);
    expect(overview.recentAudit!.every((e) => e.action === "workspace.created")).toBe(true);
    expect(overview.recentAudit).toHaveLength(1);
  });

  it("updates only the caller's workspace", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const wsA = await createWorkspaceWithMember(alice.id);
    const wsB = await createWorkspaceWithMember(bob.id);
    const ctx = await tenantContextFor(alice.id, wsA.slug);
    await updateBusinessDetails(ctx, { businessName: "Alice Biz", timezone: "Asia/Kolkata", currency: "INR" });
    const b = await db.workspace.findUniqueOrThrow({ where: { id: wsB.id } });
    expect(b.businessName).toBeNull();
    const a = await db.workspace.findUniqueOrThrow({ where: { id: wsA.id } });
    expect(a).toMatchObject({
      businessName: "Alice Biz",
      timezone: "Asia/Kolkata",
      currency: "INR",
      onboardingStep: "WHATSAPP",
    });
  });

  it("blocks unscoped queries on tenant-owned models at the database layer", async () => {
    await expect(db.workspaceInvite.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.workspaceInvite.findFirst({ where: { email: "x@example.com" } })).rejects.toBeInstanceOf(
      TenantScopeError,
    );
    await expect(db.workspaceInvite.deleteMany({})).rejects.toBeInstanceOf(TenantScopeError);
  });
});

describe("server-side permissions", () => {
  it("forbids AGENT and ANALYST from changing workspace settings", async () => {
    const owner = await createUser();
    const ws = await createWorkspaceWithMember(owner.id);
    for (const role of ["AGENT", "ANALYST"] as const) {
      const member = await createUser();
      await addMember(ws.id, member.id, role);
      const ctx = await tenantContextFor(member.id, ws.slug);
      const input = { name: "Hacked", businessName: "Hacked", timezone: "UTC", currency: "USD", logoUrl: null };
      const error = await updateWorkspaceSettings(ctx, input).catch((e: unknown) => e);
      expect(isAppError(error) && error.code).toBe("FORBIDDEN");
    }
    const unchanged = await db.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(unchanged.name).not.toBe("Hacked");
  });

  it("allows ADMIN to change settings and records which fields changed", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const ws = await createWorkspaceWithMember(owner.id);
    await addMember(ws.id, admin.id, "ADMIN");
    const ctx = await tenantContextFor(admin.id, ws.slug);
    await updateWorkspaceSettings(ctx, {
      name: ws.name,
      businessName: "New Biz",
      timezone: "UTC",
      currency: "EUR",
      logoUrl: null,
    });
    const entry = await db.auditLog.findFirstOrThrow({
      where: { workspaceId: ws.id, action: "workspace.settings_updated" },
    });
    expect(entry.actorUserId).toBe(admin.id);
    expect((entry.metadata as { fields: string[] }).fields.sort()).toEqual(["businessName", "currency"]);
  });

  it("hides the audit preview from roles without audit access", async () => {
    const owner = await createUser();
    const agent = await createUser();
    const ws = await createWorkspaceWithMember(owner.id);
    await addMember(ws.id, agent.id, "AGENT");
    const overview = await getWorkspaceOverview(await tenantContextFor(agent.id, ws.slug));
    expect(overview.recentAudit).toBeNull();
  });
});
