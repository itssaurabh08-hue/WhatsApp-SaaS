import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ContactFilter } from "@/lib/validation/contacts";
import type { SegmentCondition, SegmentDefinition } from "@/lib/segments";

type Where = Prisma.ContactWhereInput;

const DAY_MS = 24 * 60 * 60 * 1000;

function textWhere(field: "firstName" | "lastName" | "email" | "company" | "country", op: string, value = ""): Where {
  switch (op) {
    case "equals":
      return { [field]: { equals: value, mode: "insensitive" } };
    case "not_equals":
      return { OR: [{ [field]: null }, { NOT: { [field]: { equals: value, mode: "insensitive" } } }] };
    case "contains":
      return { [field]: { contains: value, mode: "insensitive" } };
    case "is_empty":
      return { OR: [{ [field]: null }, { [field]: "" }] };
    case "is_not_empty":
      return { AND: [{ NOT: { [field]: null } }, { NOT: { [field]: "" } }] };
    default:
      throw new Error(`unsupported text op ${op}`);
  }
}

function phoneWhere(op: string, value = ""): Where {
  const digits = value.replace(/[^\d+]/g, "");
  switch (op) {
    case "equals":
      return { normalizedPhoneNumber: digits };
    case "not_equals":
      return { NOT: { normalizedPhoneNumber: digits } };
    case "contains":
      return { normalizedPhoneNumber: { contains: digits } };
    case "is_empty":
      return { id: "__none__" }; // phone is required, never empty
    case "is_not_empty":
      return {};
    default:
      throw new Error(`unsupported phone op ${op}`);
  }
}

function customWhere(key: string, op: string, value = ""): Where {
  const path = [key];
  const missing: Where = {
    OR: [{ customFields: { path, equals: Prisma.AnyNull } }, { customFields: { path, equals: "" } }],
  };
  switch (op) {
    case "equals":
      return { customFields: { path, equals: value } };
    case "not_equals":
      return { OR: [missing, { NOT: { customFields: { path, equals: value } } }] };
    case "contains":
      return { customFields: { path, string_contains: value } };
    case "is_empty":
      return missing;
    case "is_not_empty":
      return { NOT: missing };
    default:
      throw new Error(`unsupported custom op ${op}`);
  }
}

function dateWhere(field: "createdAt" | "lastMessageAt", op: string, value: string, now: Date): Where {
  switch (op) {
    case "before":
      return { [field]: { lt: new Date(value) } };
    case "after":
      return { [field]: { gt: new Date(value) } };
    case "in_last_days":
      return { [field]: { gte: new Date(now.getTime() - Number(value) * DAY_MS) } };
    case "never":
      return { [field]: null };
    default:
      throw new Error(`unsupported date op ${op}`);
  }
}

export function conditionWhere(workspaceId: string, c: SegmentCondition, now = new Date()): Where {
  switch (c.field) {
    case "tag": {
      const has: Where = { tags: { some: { tagId: c.value, workspaceId } } };
      return c.op === "has" ? has : { NOT: has };
    }
    case "list": {
      const inList: Where = { lists: { some: { listId: c.value, workspaceId } } };
      return c.op === "in" ? inList : { NOT: inList };
    }
    case "optInStatus":
      return c.op === "is" ? { optInStatus: c.value } : { NOT: { optInStatus: c.value } };
    case "phoneNumber":
      return phoneWhere(c.op, c.value);
    case "firstName":
    case "lastName":
    case "email":
    case "company":
    case "country":
      return textWhere(c.field, c.op, c.field === "country" ? c.value?.toUpperCase() : c.value);
    case "custom":
      return customWhere(c.key, c.op, c.value);
    case "createdAt":
    case "lastMessageAt":
      return dateWhere(c.field, c.op, c.value, now);
  }
}

/** Compiles a validated segment definition to a Prisma filter, always scoped to the workspace. */
export function segmentWhere(workspaceId: string, def: SegmentDefinition, now = new Date()): Where {
  const parts = def.conditions.map((c) => conditionWhere(workspaceId, c, now));
  return { workspaceId, ...(def.match === "all" ? { AND: parts } : { OR: parts }) };
}

/** Filter used by the contacts table, export and bulk actions. */
export function contactFilterWhere(
  workspaceId: string,
  filter: ContactFilter,
  segment?: SegmentDefinition | null,
): Where {
  const and: Where[] = [];
  const q = filter.q?.trim();
  if (q) {
    const digits = q.replace(/[^\d]/g, "");
    and.push({
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ normalizedPhoneNumber: { contains: digits } }] : []),
      ],
    });
  }
  if (filter.tagId) and.push({ tags: { some: { tagId: filter.tagId, workspaceId } } });
  if (filter.listId) and.push({ lists: { some: { listId: filter.listId, workspaceId } } });
  if (filter.optInStatus) and.push({ optInStatus: filter.optInStatus });
  if (segment) and.push(segmentWhere(workspaceId, segment));
  return { workspaceId, AND: and };
}
