import "server-only";
import Papa from "papaparse";
import { escapeCsvCell } from "@/lib/csv";
import type { ContactFilter } from "@/lib/validation/contacts";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import type { RequestMeta } from "@/server/request-meta";
import { buildContactWhere } from "./service";

const BATCH = 2000;

/**
 * Streams contacts matching `filter` as CSV, in keyset-paginated batches so
 * large workspaces never load every row at once.
 */
export async function exportContactsCsv(ctx: TenantContext, filter: ContactFilter, meta: Partial<RequestMeta> = {}) {
  requirePermission(ctx, "contacts:export");
  const where = await buildContactWhere(ctx, filter);
  const customFields = await db.customFieldDefinition.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
    select: { key: true },
  });
  const headers = [
    "Phone number",
    "First name",
    "Last name",
    "Email",
    "Company",
    "Country",
    "Opt-in status",
    "Opt-in source",
    "Opted in at",
    "Opted out at",
    "Tags",
    "Created at",
    ...customFields.map((f) => f.key),
  ];
  const encoder = new TextEncoder();
  const line = (cells: unknown[]) =>
    encoder.encode(Papa.unparse([cells.map(escapeCsvCell)], { newline: "\r\n" }) + "\r\n");

  let cursor: string | undefined;
  let exported = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("﻿")); // BOM so spreadsheet apps detect UTF-8
      controller.enqueue(line(headers));
    },
    async pull(controller) {
      const rows = await db.contact.findMany({
        where,
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          normalizedPhoneNumber: true,
          firstName: true,
          lastName: true,
          email: true,
          company: true,
          country: true,
          optInStatus: true,
          optInSource: true,
          optInAt: true,
          optedOutAt: true,
          createdAt: true,
          customFields: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
      });
      for (const c of rows) {
        const custom = (c.customFields ?? {}) as Record<string, unknown>;
        controller.enqueue(
          line([
            c.normalizedPhoneNumber,
            c.firstName,
            c.lastName,
            c.email,
            c.company,
            c.country,
            c.optInStatus,
            c.optInSource,
            c.optInAt,
            c.optedOutAt,
            c.tags.map((t) => t.tag.name).join(", "),
            c.createdAt,
            ...customFields.map((f) => custom[f.key] ?? ""),
          ]),
        );
      }
      exported += rows.length;
      if (rows.length < BATCH) {
        // Audit before closing so the record exists by the time the download completes.
        await audit(
          {
            action: "contacts.exported",
            workspaceId: ctx.workspaceId,
            actorUserId: ctx.user.id,
            entityType: "Contact",
            metadata: { count: exported },
          },
          meta,
        );
        controller.close();
        return;
      }
      cursor = rows.at(-1)!.id;
    },
  });
  return stream;
}
